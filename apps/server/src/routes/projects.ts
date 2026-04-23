import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import type {
  CreateProjectRequest,
  CanvasImage,
  CanvasText,
  GetProjectResponse,
  ListProjectsResponse,
  PlaceAssetRequest,
  PlaceTextRequest,
  RenameProjectRequest,
} from '@vissor/shared'
import {
  appendItemOp,
  createProject,
  deleteProject,
  duplicateProject,
  getProject,
  getSnapshot,
  listProjects,
  readAssetsIndex,
  readItems,
  updateProject,
} from '../store.js'
import { projectBus } from '../bus.js'
import { cancelAndWaitForProjectIdle } from '../codex.js'

export async function projectsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/projects', async () => {
    const projects = await listProjects()
    return { projects } satisfies ListProjectsResponse
  })

  app.post<{ Body: CreateProjectRequest }>('/api/projects', async (req) => {
    const project = await createProject(req.body?.name)
    return { project }
  })

  app.get<{ Params: { id: string } }>(
    '/api/projects/:id',
    async (req, reply) => {
      const snapshot = await getSnapshot(req.params.id)
      if (!snapshot) return reply.code(404).send({ error: 'not_found' })
      return { snapshot } satisfies GetProjectResponse
    },
  )

  app.patch<{ Params: { id: string }; Body: RenameProjectRequest }>(
    '/api/projects/:id',
    async (req, reply) => {
      const patch: { name?: string; canvasBg?: string } = {}
      const name = req.body?.name?.trim()
      if (typeof name === 'string' && name.length > 0) patch.name = name
      if (typeof req.body?.canvasBg === 'string') patch.canvasBg = req.body.canvasBg
      if (Object.keys(patch).length === 0) {
        return reply.code(400).send({ error: 'nothing_to_patch' })
      }
      const next = await updateProject(req.params.id, patch)
      if (!next) return reply.code(404).send({ error: 'not_found' })
      return { project: next }
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/projects/:id',
    async (req, reply) => {
      const current = await getProject(req.params.id)
      if (!current) return reply.code(404).send({ error: 'not_found' })
      // Cancel any in-flight turn and wait for its finaliser to
      // release resources before we wipe the project dir. Otherwise
      // the finaliser recreates chat.jsonl etc. via ensureProjectDir
      // and we end up with ghost project state on disk.
      await cancelAndWaitForProjectIdle(req.params.id)
      const ok = await deleteProject(req.params.id)
      if (!ok) return reply.code(500).send({ error: 'delete_failed' })
      return { ok: true }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/api/projects/:id/duplicate',
    async (req, reply) => {
      const copy = await duplicateProject(req.params.id)
      if (!copy) return reply.code(404).send({ error: 'not_found' })
      return { project: copy }
    },
  )

  // SSE stream — per-project event firehose.
  app.get<{ Params: { id: string } }>(
    '/api/projects/:id/stream',
    async (req, reply) => {
      const project = await getProject(req.params.id)
      if (!project) return reply.code(404).send({ error: 'not_found' })
      reply.raw.setHeader('Content-Type', 'text/event-stream')
      reply.raw.setHeader('Cache-Control', 'no-cache, no-transform')
      reply.raw.setHeader('Connection', 'keep-alive')
      reply.raw.setHeader('X-Accel-Buffering', 'no')
      reply.raw.flushHeaders?.()

      // Writes can race with client disconnects: the socket might
      // already be destroyed by the time we flush. Skip silently —
      // the 'close' handler below will unsubscribe and clear the
      // timer within milliseconds anyway.
      const safeWrite = (chunk: string): void => {
        if (reply.raw.destroyed || reply.raw.writableEnded) return
        try {
          reply.raw.write(chunk)
        } catch {
          // swallow — socket tore down between the check and the write
        }
      }

      // Initial heartbeat so the browser commits the connection.
      safeWrite(': ok\n\n')

      const heartbeat = setInterval(() => {
        safeWrite(': ping\n\n')
      }, 15_000)

      const unsub = projectBus.subscribe(req.params.id, (event) => {
        safeWrite(`data: ${JSON.stringify(event)}\n\n`)
      })

      req.raw.on('close', () => {
        clearInterval(heartbeat)
        unsub()
        if (!reply.raw.writableEnded) reply.raw.end()
      })
    },
  )

  // Place an existing asset onto the canvas as a new image item.
  // Used by drag-drop uploads and any future "pull from library" flow.
  app.post<{ Params: { id: string }; Body: PlaceAssetRequest }>(
    '/api/projects/:id/items',
    async (req, reply) => {
      const { id } = req.params
      const project = await getProject(id)
      if (!project) return reply.code(404).send({ error: 'not_found' })
      const { assetId, x, y, w, h } = req.body ?? {}
      if (!assetId || typeof x !== 'number' || typeof y !== 'number') {
        return reply.code(400).send({ error: 'bad_request' })
      }
      const assets = await readAssetsIndex(id)
      const asset = assets[assetId]
      if (!asset) return reply.code(404).send({ error: 'asset_not_found' })
      const now = Date.now()
      const item: CanvasImage = {
        id: randomUUID(),
        kind: 'image',
        assetId,
        x,
        y,
        w: w ?? asset.width ?? 320,
        h: h ?? asset.height ?? 320,
        z: now,
        createdAt: now,
      }
      await appendItemOp(id, { op: 'add', item })
      projectBus.publish(id, { kind: 'item.added', item })
      return { item }
    },
  )

  // Place a text item at a world-space point.
  app.post<{ Params: { id: string }; Body: PlaceTextRequest }>(
    '/api/projects/:id/items/text',
    async (req, reply) => {
      const { id } = req.params
      const project = await getProject(id)
      if (!project) return reply.code(404).send({ error: 'not_found' })
      const { x, y, w, h, text } = req.body ?? {}
      if (typeof x !== 'number' || typeof y !== 'number') {
        return reply.code(400).send({ error: 'bad_request' })
      }
      const now = Date.now()
      const item: CanvasText = {
        id: randomUUID(),
        kind: 'text',
        text: text ?? '',
        x,
        y,
        w: w ?? 240,
        h: h ?? 80,
        z: now,
        createdAt: now,
      }
      await appendItemOp(id, { op: 'add', item })
      projectBus.publish(id, { kind: 'item.added', item })
      return { item }
    },
  )

  // Patch a single item (canvas move/resize/rename text/restyle text).
  app.patch<{
    Params: { id: string; itemId: string }
    Body: {
      x?: number
      y?: number
      w?: number
      h?: number
      z?: number
      text?: string
      fontSize?: number
      color?: string
    }
  }>('/api/projects/:id/items/:itemId', async (req, reply) => {
    const { id, itemId } = req.params
    const items = await readItems(id)
    const current = items.find((i) => i.id === itemId)
    if (!current) return reply.code(404).send({ error: 'not_found' })
    const patch = req.body ?? {}
    const next = { ...current, ...patch }
    await appendItemOp(id, { op: 'update', item: next })
    projectBus.publish(id, { kind: 'item.updated', item: next })
    return { item: next }
  })

  app.delete<{ Params: { id: string; itemId: string } }>(
    '/api/projects/:id/items/:itemId',
    async (req, reply) => {
      const { id, itemId } = req.params
      const items = await readItems(id)
      if (!items.find((i) => i.id === itemId)) {
        return reply.code(404).send({ error: 'not_found' })
      }
      await appendItemOp(id, { op: 'remove', id: itemId })
      projectBus.publish(id, { kind: 'item.removed', itemId })
      return { ok: true }
    },
  )
}

import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFile, unlink } from 'node:fs/promises'
import type { UploadResponse } from '@vissor/shared'
import { getProject, ingestFile } from '../store.js'
import { projectBus } from '../bus.js'

export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Querystring: { projectId?: string } }>('/api/uploads', async (req, reply) => {
    const projectId = req.query.projectId
    if (!projectId) return reply.code(400).send({ error: 'projectId_required' })
    const project = await getProject(projectId)
    if (!project) return reply.code(404).send({ error: 'project_not_found' })

    const parts = req.files()
    const stagedTmp: string[] = []
    const ingested = []
    try {
      for await (const part of parts) {
        const buf = await part.toBuffer()
        // Keep only the UUID for the tmp path — the user-supplied
        // filename could contain path separators or traversal
        // sequences and we don't want those resolved into our
        // filesystem. The original name is captured separately for
        // display via originalFilename.
        const tmp = join(tmpdir(), `vissor-upload-${randomUUID()}`)
        await writeFile(tmp, buf)
        stagedTmp.push(tmp)
        const asset = await ingestFile(projectId, tmp, {
          mime: part.mimetype || 'application/octet-stream',
          source: 'upload',
          originalFilename: part.filename,
        })
        ingested.push(asset)
        projectBus.publish(projectId, { kind: 'asset.added', asset })
      }
    } finally {
      await Promise.all(stagedTmp.map((p) => unlink(p).catch(() => undefined)))
    }
    return { assets: ingested } satisfies UploadResponse
  })
}

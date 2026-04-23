import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import type {
  ChatSendRequest,
  ChatSendResponse,
  UserMessage,
} from '@vissor/shared'
import { appendUserMessage, cancelTurn, runTurn } from '../codex.js'
import { getProject, readAssetsIndex } from '../store.js'

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: ChatSendRequest }>('/api/chat', async (req, reply) => {
    const {
      projectId,
      turnId,
      text,
      attachedAssetIds,
      variantCount,
      stylePreset,
      aspectRatio,
    } = req.body
    if (!projectId || !text) {
      return reply.code(400).send({ error: 'bad_request' })
    }
    const project = await getProject(projectId)
    if (!project) return reply.code(404).send({ error: 'not_found' })

    const assets = await readAssetsIndex(projectId)
    const attachedImagePaths: string[] = []
    for (const id of attachedAssetIds ?? []) {
      const a = assets[id]
      if (a) attachedImagePaths.push(a.absPath)
    }

    const userMessage: UserMessage = {
      id: randomUUID(),
      role: 'user',
      turnId,
      text,
      attachedAssetIds: attachedAssetIds ?? [],
      variantCount,
      stylePreset,
      aspectRatio,
      createdAt: Date.now(),
    }
    await appendUserMessage(projectId, userMessage)

    void runTurn({
      projectId,
      turnId,
      text,
      attachedImagePaths,
      variantCount,
      stylePreset,
      aspectRatio,
    }).catch((err) => {
      app.log.error({ err, projectId, turnId }, 'runTurn failed')
    })

    return {
      turnId,
      userMessage,
    } satisfies ChatSendResponse
  })

  app.post<{ Body: { projectId?: string; turnId?: string } }>(
    '/api/chat/cancel',
    async (req, reply) => {
      const { projectId, turnId } = req.body ?? {}
      if (!projectId || !turnId) {
        return reply.code(400).send({ error: 'bad_request' })
      }
      const canceled = cancelTurn(projectId, turnId)
      return { canceled }
    },
  )
}

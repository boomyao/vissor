import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import type { AgentMessage, ChatMessage } from '@vissor/shared'
import { ensureDirs, VISSOR_HOME } from './paths.js'
import { projectsRoutes } from './routes/projects.js'
import { chatRoutes } from './routes/chat.js'
import { uploadRoutes } from './routes/uploads.js'
import { filesRoutes } from './routes/files.js'
import { listProjects, readChat, rewriteChat } from './store.js'

/**
 * On startup, any agent message still in `streaming` state is
 * orphaned — the server that was running it is gone. Mark it failed
 * so the UI doesn't show a permanent "Thinking…" spinner.
 */
async function reconcileStuckTurns(): Promise<void> {
  const projects = await listProjects()
  for (const p of projects) {
    const chat = await readChat(p.id)
    let dirty = false
    const next = chat.map<ChatMessage>((m) => {
      if (m.role === 'agent' && m.status === 'streaming') {
        dirty = true
        return {
          ...m,
          status: 'failed',
          error: 'Server restarted before this turn finished.',
          completedAt: Date.now(),
        } satisfies AgentMessage
      }
      return m
    })
    if (dirty) await rewriteChat(p.id, next)
  }
}

async function main(): Promise<void> {
  await ensureDirs()
  await reconcileStuckTurns()

  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
  })

  await app.register(cors, {
    origin: true,
    credentials: true,
  })
  await app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024, files: 10 },
  })

  app.get('/api/health', async () => ({ ok: true, home: VISSOR_HOME }))

  await app.register(projectsRoutes)
  await app.register(chatRoutes)
  await app.register(uploadRoutes)
  await app.register(filesRoutes)

  const port = Number(process.env.PORT ?? 5174)
  await app.listen({ port, host: '127.0.0.1' })
  app.log.info({ port, home: VISSOR_HOME }, 'vissor server up')
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[vissor:server] fatal', err)
  process.exit(1)
})

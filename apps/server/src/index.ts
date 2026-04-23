import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import type { AgentMessage, ChatMessage } from '@vissor/shared'
import { cancelAllTurns } from './codex.js'
import { cleanScratchOnBoot, ensureDirs, VISSOR_HOME } from './paths.js'
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
  await cleanScratchOnBoot()
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

  // Graceful shutdown: stop accepting new connections, signal any
  // in-flight codex children to wind down, then exit. If someone
  // SIGKILLs us anyway the next boot's reconcileStuckTurns cleans up.
  let shuttingDown = false
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return
    shuttingDown = true
    const killed = cancelAllTurns()
    app.log.info({ signal, killed }, 'vissor server shutting down')
    const hardExit = setTimeout(() => process.exit(0), 3_000)
    hardExit.unref()
    void app.close().then(() => process.exit(0))
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

// Global safety nets. The server has a lot of fire-and-forget work
// (SSE writes, chat.jsonl rewrites, codex child lifecycle), so a stray
// unhandled rejection is more likely to be a bug we want to see than
// something worth crashing over. Log both, keep running.
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('[vissor:server] unhandledRejection', reason)
})
process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('[vissor:server] uncaughtException', err)
})

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[vissor:server] fatal', err)
  process.exit(1)
})

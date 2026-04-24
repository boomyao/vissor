import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import type { AgentMessage, ChatMessage } from '@vissor/shared'
import { attachUser, getUserIdByUsername } from './auth.js'
import { cancelAllTurns } from './codex.js'
import { getDb } from './db.js'
import { cleanScratchOnBoot, ensureDirs, VISSOR_HOME } from './paths.js'
import { authRoutes } from './routes/auth.js'
import { projectsRoutes } from './routes/projects.js'
import { chatRoutes } from './routes/chat.js'
import { uploadRoutes } from './routes/uploads.js'
import { filesRoutes } from './routes/files.js'
import {
  backfillLegacyOwner,
  listProjects,
  readChat,
  rewriteChat,
} from './store.js'

/**
 * Pre-auth projects carry no `ownerId`. On boot, if
 * `VISSOR_LEGACY_OWNER` points to an existing user, adopt every
 * orphan project under that user. Without it, orphans stay hidden
 * (invisible to every user, not deleted) until someone sets it.
 */
async function migrateLegacyProjects(): Promise<void> {
  const legacyUsername = process.env.VISSOR_LEGACY_OWNER
  if (!legacyUsername) return
  const ownerId = await getUserIdByUsername(legacyUsername)
  if (!ownerId) {
    // eslint-disable-next-line no-console
    console.warn(
      `[vissor:server] VISSOR_LEGACY_OWNER="${legacyUsername}" is not a known user; skipping legacy-project migration`,
    )
    return
  }
  const n = await backfillLegacyOwner(ownerId)
  if (n > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[vissor:server] assigned ${n} legacy project(s) to "${legacyUsername}"`,
    )
  }
}

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
  // Init SQLite + run migrations before anything touches the auth
  // layer. Failing here means no login is possible, so crash loudly.
  await getDb()
  await migrateLegacyProjects()
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

  // Populate req.authUser from the session cookie (if any) for every
  // request, before route-level guards run. Cheap: one indexed SQLite
  // lookup. Routes that need a user use `requireAuth` as preHandler.
  app.addHook('preHandler', attachUser)

  app.get('/api/health', async () => ({ ok: true, home: VISSOR_HOME }))

  await app.register(authRoutes)
  await app.register(projectsRoutes)
  await app.register(chatRoutes)
  await app.register(uploadRoutes)
  await app.register(filesRoutes)

  const port = Number(process.env.PORT ?? 9999)
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

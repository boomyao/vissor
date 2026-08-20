import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import { access } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, sep } from 'node:path'
import type { AgentMessage, ChatMessage } from '@vissor/shared'
import { attachUser, getUserIdByUsername } from './auth.js'
import { cancelAllTurns } from './codex.js'
import { resolveCodex } from './codexPath.js'
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
 * Locate the built web SPA. Returns null if nothing is there — dev
 * mode happily runs without it because Vite serves the frontend on a
 * separate port. Prefers `VISSOR_WEB_DIST` for deployments where the
 * server and web dist live in unrelated paths.
 */
async function resolveWebDist(): Promise<string | null> {
  const candidates: string[] = []
  if (process.env.VISSOR_WEB_DIST) {
    candidates.push(resolve(process.env.VISSOR_WEB_DIST))
  }
  const here = dirname(fileURLToPath(import.meta.url))
  // apps/server/src -> apps/web/dist
  candidates.push(resolve(here, '..', '..', 'web', 'dist'))
  // apps/server/dist -> apps/web/dist (post-tsc compile layout)
  candidates.push(resolve(here, '..', '..', '..', 'web', 'dist'))
  for (const dir of candidates) {
    try {
      await access(join(dir, 'index.html'))
      return dir
    } catch {
      // try next
    }
  }
  return null
}

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
          errorKind: 'interrupted',
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
  const codexBin = resolveCodex()

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

  app.get('/api/health', async (_req, reply) => {
    const codexBin = resolveCodex()
    const codex = codexBin.startsWith('/') && existsSync(codexBin)
    let db = false
    try {
      const handle = await getDb()
      handle.query('SELECT 1').get()
      db = true
    } catch {
      db = false
    }
    let home = false
    try {
      await access(VISSOR_HOME)
      home = true
    } catch {
      home = false
    }
    const ok = codex && db && home
    if (!ok) reply.code(503)
    return { ok, home: VISSOR_HOME, checks: { codex, db, home } }
  })

  await app.register(authRoutes)
  await app.register(projectsRoutes)
  await app.register(chatRoutes)
  await app.register(uploadRoutes)
  await app.register(filesRoutes)

  // In production, serve the built web app from the same process so
  // there's a single public port to expose (e.g. via Cloudflare
  // Tunnel). The web package emits to `apps/web/dist`; `VISSOR_WEB_DIST`
  // overrides for non-monorepo layouts. If the build output isn't
  // there we skip silently so dev (Vite on a separate port) still
  // works identically.
  const webDist = await resolveWebDist()
  if (webDist) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      index: ['index.html'],
      // The SPA owns client-side routing; any non-/api path that
      // misses a static file should fall through to index.html so
      // deep links work on refresh.
      wildcard: false,
      cacheControl: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache')
        } else if (filePath.includes(`${sep}assets${sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        } else {
          res.setHeader('Cache-Control', 'public, max-age=86400')
        }
      },
    })
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith('/api/')) {
        return reply.code(404).send({ error: 'not_found' })
      }
      const pathname = req.raw.url?.split('?')[0] ?? '/'
      if (/\.[a-z0-9]+$/i.test(pathname)) {
        return reply.code(404).send({ error: 'not_found' })
      }
      return reply.sendFile('index.html')
    })
    app.log.info({ webDist }, 'serving web SPA')
  }

  const port = Number(process.env.PORT ?? 9999)
  // Bind to 0.0.0.0 in production so Cloudflare Tunnel (or any other
  // reverse proxy reaching in from outside 127.0.0.1) can connect.
  // Keep 127.0.0.1 in dev — Vite already fronts us.
  const host = process.env.HOST ?? (webDist ? '0.0.0.0' : '127.0.0.1')
  await app.listen({ port, host })
  app.log.info(
    { port, host, home: VISSOR_HOME, codexBin },
    'vissor server up',
  )
  if (!codexBin.startsWith('/')) {
    app.log.warn(
      { codexBin },
      'codex binary did not resolve to an absolute path; image turns will likely fail',
    )
  }

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

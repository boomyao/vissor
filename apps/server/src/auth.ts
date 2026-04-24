import { randomBytes, randomUUID } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { getDb } from './db.js'

/**
 * Session cookie name. HttpOnly + SameSite=Lax + Secure in prod.
 * Signed solely through SQLite lookup — the token is opaque (32
 * random bytes hex) and matched against the `sessions` table.
 */
export const COOKIE_NAME = 'vissor_session'
const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 30 // 30 days

export interface AuthUser {
  id: string
  username: string
}

interface UserRow {
  id: string
  username: string
  password_hash: string
}

interface SessionRow {
  token: string
  user_id: string
  expires_at: number
}

export async function createUser(
  username: string,
  password: string,
): Promise<AuthUser> {
  const db = await getDb()
  const existing = db
    .query<UserRow, [string]>('SELECT * FROM users WHERE username = ?')
    .get(username)
  if (existing) throw new Error(`user "${username}" already exists`)
  const id = randomUUID()
  const hash = await Bun.password.hash(password, {
    algorithm: 'argon2id',
    memoryCost: 19456,
    timeCost: 2,
  })
  db.run(
    'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
    [id, username, hash, Date.now()],
  )
  return { id, username }
}

export async function verifyLogin(
  username: string,
  password: string,
): Promise<AuthUser | null> {
  const db = await getDb()
  const row = db
    .query<UserRow, [string]>('SELECT * FROM users WHERE username = ?')
    .get(username)
  if (!row) return null
  const ok = await Bun.password.verify(password, row.password_hash)
  if (!ok) return null
  return { id: row.id, username: row.username }
}

export async function createSession(userId: string): Promise<string> {
  const db = await getDb()
  const token = randomBytes(32).toString('hex')
  const now = Date.now()
  db.run(
    'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    [token, userId, now, now + COOKIE_MAX_AGE_SEC * 1000],
  )
  return token
}

export async function destroySession(token: string): Promise<void> {
  const db = await getDb()
  db.run('DELETE FROM sessions WHERE token = ?', [token])
}

export async function lookupSession(token: string): Promise<AuthUser | null> {
  const db = await getDb()
  const row = db
    .query<SessionRow, [string]>('SELECT * FROM sessions WHERE token = ?')
    .get(token)
  if (!row) return null
  if (row.expires_at < Date.now()) {
    db.run('DELETE FROM sessions WHERE token = ?', [token])
    return null
  }
  const user = db
    .query<UserRow, [string]>('SELECT * FROM users WHERE id = ?')
    .get(row.user_id)
  return user ? { id: user.id, username: user.username } : null
}

export async function listUsers(): Promise<AuthUser[]> {
  const db = await getDb()
  const rows = db
    .query<UserRow, []>('SELECT * FROM users ORDER BY username ASC')
    .all()
  return rows.map((r) => ({ id: r.id, username: r.username }))
}

/** Find the user id by username. Used for legacy-project migration. */
export async function getUserIdByUsername(
  username: string,
): Promise<string | null> {
  const db = await getDb()
  const row = db
    .query<Pick<UserRow, 'id'>, [string]>(
      'SELECT id FROM users WHERE username = ?',
    )
    .get(username)
  return row?.id ?? null
}

// ---------- cookie parsing / serialisation (no extra deps) ----------

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {}
  const out: Record<string, string> = {}
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const k = part.slice(0, eq).trim()
    const v = part.slice(eq + 1).trim()
    if (k) out[k] = decodeURIComponent(v)
  }
  return out
}

export function readSessionToken(req: FastifyRequest): string | null {
  const cookies = parseCookies(req.headers.cookie)
  return cookies[COOKIE_NAME] ?? null
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${COOKIE_MAX_AGE_SEC}`,
  ]
  if (process.env.NODE_ENV === 'production') attrs.push('Secure')
  reply.header('Set-Cookie', attrs.join('; '))
}

export function clearSessionCookie(reply: FastifyReply): void {
  const attrs = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ]
  if (process.env.NODE_ENV === 'production') attrs.push('Secure')
  reply.header('Set-Cookie', attrs.join('; '))
}

// ---------- request context & middleware ----------

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser
  }
}

/**
 * Attach `req.authUser` from the session cookie (if valid). This is
 * NON-ENFORCING — use `requireAuth` as a preHandler on routes that
 * need a logged-in user. Called once per request by a global hook so
 * anything downstream can read the user cheaply.
 */
export async function attachUser(req: FastifyRequest): Promise<void> {
  const token = readSessionToken(req)
  if (!token) return
  const user = await lookupSession(token)
  if (user) req.authUser = user
}

/**
 * preHandler guard. 401s if no authUser on the request. Use on every
 * API route that touches per-user data.
 */
export async function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!req.authUser) {
    reply.code(401).send({ error: 'unauthorized' })
  }
}

import type { FastifyInstance } from 'fastify'
import type {
  LoginRequest,
  LoginResponse,
  MeResponse,
} from '@vissor/shared'
import {
  clearSessionCookie,
  createSession,
  destroySession,
  readSessionToken,
  setSessionCookie,
  verifyLogin,
} from '../auth.js'

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: LoginRequest }>('/api/auth/login', async (req, reply) => {
    const { username, password } = req.body ?? {}
    if (!username || !password) {
      return reply.code(400).send({ error: 'bad_request' })
    }
    const user = await verifyLogin(username, password)
    if (!user) return reply.code(401).send({ error: 'invalid_credentials' })
    const token = await createSession(user.id)
    setSessionCookie(reply, token)
    return { user } satisfies LoginResponse
  })

  app.post('/api/auth/logout', async (req, reply) => {
    const token = readSessionToken(req)
    if (token) await destroySession(token)
    clearSessionCookie(reply)
    return { ok: true }
  })

  app.get('/api/auth/me', async (req) => {
    return { user: req.authUser ?? null } satisfies MeResponse
  })
}

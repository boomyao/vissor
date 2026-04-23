import type { FastifyInstance } from 'fastify'
import { createReadStream } from 'node:fs'
import { stat, readdir } from 'node:fs/promises'
import { ASSETS_DIR } from '../paths.js'
import { join } from 'node:path'

/**
 * Serve an asset by id. Assets are stored content-addressed in
 * ASSETS_DIR with the extension the originating file carried.
 */
export async function filesRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>('/api/files/:id', async (req, reply) => {
    const { id } = req.params
    // Asset ids are 24-hex sha prefixes; reject anything else defensively.
    if (!/^[a-f0-9]{24}$/.test(id)) {
      return reply.code(400).send({ error: 'bad_id' })
    }
    // Find the file — we don't know the extension here, so scan for id.*
    const entries = await readdir(ASSETS_DIR).catch(() => [] as string[])
    const match = entries.find((name) => name.startsWith(id))
    if (!match) return reply.code(404).send({ error: 'not_found' })
    const abs = join(ASSETS_DIR, match)
    const s = await stat(abs)
    const mime = mimeFromExt(match)
    reply.header('Content-Type', mime)
    reply.header('Content-Length', s.size)
    reply.header('Cache-Control', 'public, max-age=31536000, immutable')
    return reply.send(createReadStream(abs))
  })
}

function mimeFromExt(name: string): string {
  if (name.endsWith('.png')) return 'image/png'
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg'
  if (name.endsWith('.webp')) return 'image/webp'
  if (name.endsWith('.gif')) return 'image/gif'
  if (name.endsWith('.svg')) return 'image/svg+xml'
  return 'application/octet-stream'
}

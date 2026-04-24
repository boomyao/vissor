/**
 * Minimal admin CLI for the accounts table. Usage (run with bun):
 *   bun scripts/users.ts add <username> <password>
 *   bun scripts/users.ts list
 *   bun scripts/users.ts set-password <username> <password>
 *   bun scripts/users.ts delete <username>
 *
 * All data lives in ~/.vissor/vissor.db. Passwords are argon2id
 * hashed via Bun.password.
 */
import { getDb } from '../src/db.js'
import {
  createUser,
  getUserIdByUsername,
  listUsers,
} from '../src/auth.js'

async function main(): Promise<void> {
  await getDb()
  const [cmd, ...args] = process.argv.slice(2)
  switch (cmd) {
    case 'add': {
      const [username, password] = args
      if (!username || !password) usage()
      const u = await createUser(username, password)
      console.log(`created user: ${u.username} (${u.id})`)
      return
    }
    case 'list': {
      const users = await listUsers()
      for (const u of users) console.log(`${u.username}\t${u.id}`)
      return
    }
    case 'set-password': {
      const [username, password] = args
      if (!username || !password) usage()
      const db = await getDb()
      const id = await getUserIdByUsername(username)
      if (!id) {
        console.error(`no such user: ${username}`)
        process.exit(1)
      }
      const hash = await Bun.password.hash(password, {
        algorithm: 'argon2id',
        memoryCost: 19456,
        timeCost: 2,
      })
      db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id])
      // Also invalidate any active sessions for safety.
      db.run('DELETE FROM sessions WHERE user_id = ?', [id])
      console.log(`updated password for ${username}`)
      return
    }
    case 'delete': {
      const [username] = args
      if (!username) usage()
      const db = await getDb()
      const id = await getUserIdByUsername(username)
      if (!id) {
        console.error(`no such user: ${username}`)
        process.exit(1)
      }
      db.run('DELETE FROM users WHERE id = ?', [id])
      console.log(`deleted ${username}`)
      return
    }
    default:
      usage()
  }
}

function usage(): never {
  console.error(
    'usage: bun scripts/users.ts <add|list|set-password|delete> [args...]',
  )
  process.exit(1)
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})

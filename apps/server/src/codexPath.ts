import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Locate the user's "real" codex binary.
 *
 * Why: `bun run --filter @vissor/server …` prepends workspace
 * node_modules/.bin dirs to PATH. On this machine that causes
 * `codex` to resolve to an older pnpm-installed 0.47.0 binary in
 * `~/node_modules/.bin`, even though the shell's `codex` points at
 * 0.122 via `~/.bun/bin`. 0.47.0's `exec resume` subcommand does not
 * accept `--json`, so turns fail with
 *   `error: unexpected argument '--json' found`
 *
 * We side-step the PATH confusion by asking a real login shell once,
 * at server boot, for its `which codex` answer and caching the
 * resolved absolute path. If resolution fails we fall back to bare
 * `codex` and hope the ambient PATH is OK.
 */
let resolved: string | null = null

const MIN_SUPPORTED = '0.120.0' // First release that supports `exec resume --json`.

export function resolveCodex(): string {
  if (resolved) return resolved
  // 1. Respect an explicit override.
  const override = process.env.VISSOR_CODEX_PATH
  if (override && existsSync(override)) {
    resolved = override
    return resolved
  }
  // 2. Walk a prioritised list of well-known install locations. We
  // prefer bun-installed globals (typically the newest) over pnpm
  // vendor dirs that linger from older installs. Whichever binary
  // reports a compatible version wins.
  const candidates = [
    join(homedir(), '.bun', 'bin', 'codex'),
    join(homedir(), '.npm-global', 'bin', 'codex'),
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    // Last-resort — login shell's `command -v codex` (often the right
    // answer on systems where the user curated their PATH carefully).
  ]
  const shellResolved = tryLoginShell()
  if (shellResolved) candidates.push(shellResolved)

  for (const p of candidates) {
    if (!existsSync(p)) continue
    if (isVersionAtLeast(p, MIN_SUPPORTED)) {
      resolved = p
      return resolved
    }
  }
  // 3. Nothing matched. Fall back to bare name.
  resolved = 'codex'
  return resolved
}

function tryLoginShell(): string | null {
  try {
    const out = execFileSync('/bin/sh', ['-lc', 'command -v codex'], {
      encoding: 'utf8',
    }).trim()
    return out || null
  } catch {
    return null
  }
}

function isVersionAtLeast(binPath: string, min: string): boolean {
  try {
    const out = execFileSync(binPath, ['--version'], { encoding: 'utf8' })
    // Typical output: "codex-cli 0.122.0"
    const m = /(\d+)\.(\d+)\.(\d+)/.exec(out)
    if (!m) return false
    const got = [+m[1], +m[2], +m[3]]
    const need = min.split('.').map((s) => +s)
    for (let i = 0; i < 3; i++) {
      if (got[i] > need[i]) return true
      if (got[i] < need[i]) return false
    }
    return true
  } catch {
    return false
  }
}

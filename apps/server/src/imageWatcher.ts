import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Per-project singleton watcher for codex's generated_images folder.
 *
 * Codex 0.122 writes generated PNGs to
 *   ~/.codex/generated_images/<thread_id>/ig_*.png
 *
 * We run one watcher per project for the lifetime of the server. The
 * watcher polls the directory, notes every new stable file, and
 * forwards it to whichever handler is currently registered (set by the
 * active turn). Because the per-project turn mutex guarantees at most
 * one turn is running at a time, files that land while a turn holds
 * the handler are unambiguously attributed to that turn. Files that
 * land when no handler is registered are still remembered as "seen"
 * so they don't leak into the next turn.
 *
 * This replaces the previous per-turn watcher, which double-subscribed
 * during the 800ms grace window and also risked missing files that
 * landed right after the grace expired.
 */

type Handler = (absPath: string) => Promise<void> | void

interface ProjectWatcher {
  threadId: string
  seen: Set<string>
  pending: Map<string, number>
  handler: Handler | null
  stopped: boolean
}

const POLL_MS = 300

const watchers = new Map<string, ProjectWatcher>() // key: projectId

function generatedImagesDir(threadId: string): string {
  return join(homedir(), '.codex', 'generated_images', threadId)
}

async function seedExistingImages(threadId: string): Promise<Set<string>> {
  try {
    const entries = await readdir(generatedImagesDir(threadId))
    return new Set(entries)
  } catch {
    return new Set()
  }
}

async function tick(projectId: string): Promise<void> {
  const w = watchers.get(projectId)
  if (!w || w.stopped) return
  const dir = generatedImagesDir(w.threadId)
  let entries: string[] = []
  try {
    entries = await readdir(dir)
  } catch {
    // Dir may not exist yet — codex creates it lazily.
  }
  for (const name of entries) {
    if (w.seen.has(name)) continue
    const abs = join(dir, name)
    try {
      const s = await stat(abs)
      if (!s.isFile()) continue
      // Wait for the file size to stabilise before ingesting, else we
      // risk reading a half-written PNG.
      const prev = w.pending.get(name)
      if (prev !== undefined && prev === s.size && s.size > 0) {
        w.pending.delete(name)
        w.seen.add(name)
        if (w.handler) {
          try {
            await w.handler(abs)
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`[watcher:${projectId}] handler failed`, err)
          }
        }
        // else: file landed outside any turn, retained as seen so it
        // won't be reprocessed later.
      } else {
        w.pending.set(name, s.size)
      }
    } catch {
      // Racing a rename; ignore and try again next tick.
    }
  }
  if (!w.stopped) {
    setTimeout(() => void tick(projectId), POLL_MS)
  }
}

/**
 * Ensure a watcher exists for the given project+thread. Safe to call
 * repeatedly; if a watcher already exists for this project it is
 * reused (even if threadId differs, the caller asked us to track a
 * new thread so we swap it).
 */
export async function ensureWatcher(
  projectId: string,
  threadId: string,
): Promise<void> {
  const existing = watchers.get(projectId)
  if (existing && existing.threadId === threadId && !existing.stopped) {
    return
  }
  if (existing) existing.stopped = true

  const seen = await seedExistingImages(threadId)
  const w: ProjectWatcher = {
    threadId,
    seen,
    pending: new Map(),
    handler: null,
    stopped: false,
  }
  watchers.set(projectId, w)
  void tick(projectId)
}

export function setHandler(projectId: string, handler: Handler | null): void {
  const w = watchers.get(projectId)
  if (!w) return
  w.handler = handler
}

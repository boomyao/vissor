/**
 * Keyed async mutex. `runExclusive(key, fn)` guarantees only one `fn`
 * runs per key at a time — later callers queue up behind the current
 * holder. We need this because `runTurn` does read-modify-write cycles
 * on `chat.jsonl` (rewriteChat) that can race if two turns for the
 * same project overlap.
 */
const chains = new Map<string, Promise<unknown>>()

export function runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  // Clean up when this link settles — but only if it's still the tail.
  const cleanup = () => {
    if (chains.get(key) === next) chains.delete(key)
  }
  next.then(cleanup, cleanup)
  chains.set(key, next)
  return next
}

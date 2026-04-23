import { useEffect } from 'react'
import type { ChatStreamEvent } from '@vissor/shared'
import { api } from './api.js'
import { useStore } from '../store/store.js'

/**
 * Attach an EventSource to the project's SSE endpoint and pipe every
 * event into the store. The browser's EventSource auto-reconnects on
 * drop; we additionally resync full project state on every reconnect
 * because events that landed during the disconnect window are lost —
 * the backend bus does no replay.
 */
export function useProjectStream(projectId: string | null): void {
  const applyEvent = useStore((s) => s.applyEvent)
  const loadSnapshot = useStore((s) => s.loadSnapshot)

  useEffect(() => {
    if (!projectId) return
    let openCount = 0
    let resyncing = false
    const pending: ChatStreamEvent[] = []

    const es = new EventSource(api.streamUrl(projectId))
    es.onopen = () => {
      openCount++
      if (openCount === 1) return
      // Reconnect — pull a fresh snapshot so we pick up any events we
      // missed while the socket was down. Buffer any events that
      // arrive while the snapshot request is in flight and replay them
      // after, so late deltas aren't clobbered by the snapshot write.
      resyncing = true
      api
        .getProject(projectId)
        .then(({ snapshot }) => loadSnapshot(snapshot))
        .catch(() => undefined)
        .finally(() => {
          // Flush any events that arrived during the snapshot fetch.
          // Done in finally (not then) so we never drop buffered events
          // even if the snapshot request failed: whatever state we had
          // plus those deltas is still better than silently losing them.
          while (pending.length) {
            const ev = pending.shift()
            if (ev) applyEvent(ev)
          }
          resyncing = false
        })
    }
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as ChatStreamEvent
        if (resyncing) pending.push(data)
        else applyEvent(data)
      } catch {
        // Ignore malformed lines.
      }
    }
    es.onerror = () => {
      // EventSource auto-retries; log once for visibility.
      // eslint-disable-next-line no-console
      console.warn('[vissor] SSE connection hiccup, retrying…')
    }
    return () => {
      es.close()
    }
  }, [projectId, applyEvent, loadSnapshot])
}

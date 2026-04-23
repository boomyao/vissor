import { useEffect } from 'react'
import type { ChatStreamEvent } from '@vissor/shared'
import { api } from './api.js'
import { useStore } from '../store/store.js'

/**
 * Attach an EventSource to the project's SSE endpoint and pipe every
 * event into the store. Reconnects automatically on drop.
 */
export function useProjectStream(projectId: string | null): void {
  const applyEvent = useStore((s) => s.applyEvent)

  useEffect(() => {
    if (!projectId) return
    const es = new EventSource(api.streamUrl(projectId))
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as ChatStreamEvent
        applyEvent(data)
      } catch {
        // Ignore malformed lines.
      }
    }
    es.onerror = () => {
      // EventSource auto-retries; log once for visibility.
      // eslint-disable-next-line no-console
      console.warn('[vissor] SSE connection hiccup, retrying...')
    }
    return () => {
      es.close()
    }
  }, [projectId, applyEvent])
}

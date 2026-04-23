import { EventEmitter } from 'node:events'
import type { ChatStreamEvent } from '@vissor/shared'

/**
 * Per-project pub/sub. Events fan out to any SSE subscribers attached
 * to /api/projects/:id/stream. We intentionally do NOT replay history —
 * clients fetch the full snapshot on (re)connect via /api/projects/:id.
 */
class ProjectBus {
  private emitter = new EventEmitter()

  constructor() {
    // Unbounded — one server, low fan-out. Raise the cap to avoid warnings.
    this.emitter.setMaxListeners(0)
  }

  publish(projectId: string, event: ChatStreamEvent): void {
    this.emitter.emit(projectId, event)
  }

  subscribe(
    projectId: string,
    listener: (event: ChatStreamEvent) => void,
  ): () => void {
    this.emitter.on(projectId, listener)
    return () => this.emitter.off(projectId, listener)
  }
}

export const projectBus = new ProjectBus()

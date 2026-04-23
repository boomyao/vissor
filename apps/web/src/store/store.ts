import { create } from 'zustand'
import type {
  AgentMessage,
  Asset,
  CanvasItem,
  ChatMessage,
  ChatStreamEvent,
  Project,
  ProjectSnapshot,
} from '@vissor/shared'
import type { SnapGuide } from '../lib/snap.js'

export interface Camera {
  x: number // world offset (pan)
  y: number
  scale: number // zoom factor; 1 = 100%
}

export interface AppState {
  project: Project | null
  /** Flat list of all known projects — drives the top-bar switcher. */
  projects: Project[]
  items: CanvasItem[]
  assets: Record<string, Asset>
  chat: ChatMessage[]

  camera: Camera
  selection: Set<string>
  /** Items pending insertion into the "context tray" for the next prompt. */
  attachedAssetIds: string[]
  /** Which asset is shown in the right-side drawer. */
  drawerAssetId: string | null
  /** Turn currently streaming, if any. */
  activeTurnId: string | null
  /** Snap guides rendered while a drag is in progress. */
  activeGuides: SnapGuide[]

  // --- project loading ---
  setProjects: (list: Project[]) => void
  loadSnapshot: (snap: ProjectSnapshot) => void
  reset: () => void

  // --- camera ---
  setCamera: (camera: Camera) => void
  panBy: (dx: number, dy: number) => void
  zoomAt: (clientX: number, clientY: number, factor: number) => void

  // --- selection ---
  toggleSelection: (itemId: string, additive: boolean) => void
  clearSelection: () => void

  // --- attach tray ---
  attachAsset: (assetId: string) => void
  detachAsset: (assetId: string) => void
  clearAttached: () => void

  // --- drawer ---
  openDrawer: (assetId: string | null) => void

  // --- sse application ---
  applyEvent: (event: ChatStreamEvent) => void

  // --- local-only item updates (optimistic) ---
  patchItem: (itemId: string, patch: Partial<CanvasItem>) => void
  setActiveTurn: (turnId: string | null) => void
  setGuides: (guides: SnapGuide[]) => void
}

function withAgentMessage(
  chat: ChatMessage[],
  turnId: string,
  patch: Partial<AgentMessage>,
): ChatMessage[] {
  return chat.map((m) =>
    m.role === 'agent' && m.turnId === turnId ? { ...m, ...patch } : m,
  )
}

export const useStore = create<AppState>((set, get) => ({
  project: null,
  projects: [],
  items: [],
  assets: {},
  chat: [],

  camera: { x: 0, y: 0, scale: 1 },
  selection: new Set(),
  attachedAssetIds: [],
  drawerAssetId: null,
  activeTurnId: null,
  activeGuides: [],

  setProjects: (list) => set({ projects: list }),

  loadSnapshot: (snap) =>
    set({
      project: snap.project,
      items: snap.items,
      assets: snap.assets,
      chat: snap.chat,
      // Switching projects wipes ephemeral view state.
      selection: new Set(),
      attachedAssetIds: [],
      drawerAssetId: null,
      activeTurnId: null,
    }),

  reset: () =>
    set({
      project: null,
      items: [],
      assets: {},
      chat: [],
      camera: { x: 0, y: 0, scale: 1 },
      selection: new Set(),
      attachedAssetIds: [],
      drawerAssetId: null,
      activeTurnId: null,
    }),

  setCamera: (camera) => set({ camera }),

  panBy: (dx, dy) =>
    set((s) => ({
      camera: { ...s.camera, x: s.camera.x + dx, y: s.camera.y + dy },
    })),

  zoomAt: (clientX, clientY, factor) => {
    const { camera } = get()
    const nextScale = clamp(camera.scale * factor, 0.1, 4)
    // Keep the cursor-anchored world point fixed on screen:
    //   world = (client - cam) / scale
    //   after: client = world * nextScale + nextCam
    //   => nextCam = client - world * nextScale
    const worldX = (clientX - camera.x) / camera.scale
    const worldY = (clientY - camera.y) / camera.scale
    const x = clientX - worldX * nextScale
    const y = clientY - worldY * nextScale
    set({ camera: { x, y, scale: nextScale } })
  },

  toggleSelection: (itemId, additive) =>
    set((s) => {
      const next = additive ? new Set(s.selection) : new Set<string>()
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return { selection: next }
    }),

  clearSelection: () => set({ selection: new Set() }),

  attachAsset: (assetId) =>
    set((s) =>
      s.attachedAssetIds.includes(assetId)
        ? s
        : { attachedAssetIds: [...s.attachedAssetIds, assetId] },
    ),
  detachAsset: (assetId) =>
    set((s) => ({
      attachedAssetIds: s.attachedAssetIds.filter((id) => id !== assetId),
    })),
  clearAttached: () => set({ attachedAssetIds: [] }),

  openDrawer: (assetId) => set({ drawerAssetId: assetId }),

  applyEvent: (event) =>
    set((s) => {
      switch (event.kind) {
        case 'session.codexId':
          return s.project
            ? {
                project: {
                  ...s.project,
                  codexSessionId: event.codexSessionId,
                },
              }
            : s
        case 'turn.started':
          return { activeTurnId: event.turnId }
        case 'turn.status':
          return {
            chat: withAgentMessage(s.chat, event.turnId, {
              statusLine: event.statusLine,
            }),
          }
        case 'turn.text.delta':
          return {
            chat: s.chat.map((m) =>
              m.role === 'agent' && m.turnId === event.turnId
                ? { ...m, text: m.text + event.delta }
                : m,
            ),
          }
        case 'turn.text.final':
          return {
            chat: withAgentMessage(s.chat, event.turnId, { text: event.text }),
          }
        case 'turn.completed':
          return {
            activeTurnId: s.activeTurnId === event.turnId ? null : s.activeTurnId,
            chat: withAgentMessage(s.chat, event.turnId, {
              status: 'completed',
              completedAt: Date.now(),
            }),
          }
        case 'turn.failed':
          return {
            activeTurnId: s.activeTurnId === event.turnId ? null : s.activeTurnId,
            chat: withAgentMessage(s.chat, event.turnId, {
              status: 'failed',
              error: event.error,
            }),
          }
        case 'asset.added':
          return {
            assets: { ...s.assets, [event.asset.id]: event.asset },
          }
        case 'item.added':
          return { items: [...s.items, event.item] }
        case 'item.updated':
          return {
            items: s.items.map((i) =>
              i.id === event.item.id ? event.item : i,
            ),
          }
        case 'item.removed':
          return { items: s.items.filter((i) => i.id !== event.itemId) }
        default:
          return s
      }
    }),

  patchItem: (itemId, patch) =>
    set((s) => ({
      items: s.items.map((i) => (i.id === itemId ? ({ ...i, ...patch } as CanvasItem) : i)),
    })),

  setActiveTurn: (turnId) => set({ activeTurnId: turnId }),

  setGuides: (guides) => set({ activeGuides: guides }),
}))

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

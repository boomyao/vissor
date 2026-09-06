import { create } from 'zustand'
import type {
  AgentMessage,
  Asset,
  AspectRatio,
  CanvasItem,
  ChatMessage,
  ChatStreamEvent,
  Project,
  ProjectSnapshot,
} from '@vissor/shared'
import { ASPECT_DIMS, DEFAULT_IMAGE_COUNT, MAX_IMAGE_COUNT, imageSlotPosition } from '@vissor/shared'
import type { SnapGuide } from '../lib/snap.js'
import { fitCameraTo } from '../lib/camera.js'

/**
 * A client-side placeholder for a variant that codex is still
 * generating. We paint these on the canvas in the same grid the
 * server will place the real tiles into, and remove them one-by-one
 * as real tiles arrive (matched by turnId).
 */
export interface SkeletonSlot {
  turnId: string
  variantIndex: number
  x: number
  y: number
  w: number
  h: number
  title?: string
}

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
  /**
   * Client-only placeholders for variants still being painted by
   * codex. Keyed by turnId, ordered by variant slot. Populated when
   * the user submits a turn and consumed as real image items land.
   */
  pendingSkeletons: Record<string, SkeletonSlot[]>

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

  /** Lay down N skeleton slots for an about-to-start turn. */
  startPendingSkeletons: (
    turnId: string,
    count: number,
    aspectRatio: AspectRatio | undefined,
  ) => void
  /** Clear any remaining skeletons for a turn. */
  clearPendingSkeletons: (turnId: string) => void
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

function skeletonSlots(
  items: CanvasItem[],
  turnId: string,
  count: number,
  aspectRatio?: AspectRatio,
  completed = 0,
  titles?: string[],
): SkeletonSlot[] {
  const n = Number.isInteger(count) ? Math.max(1, Math.min(MAX_IMAGE_COUNT, count)) : DEFAULT_IMAGE_COUNT
  const dims = ASPECT_DIMS[aspectRatio ?? 'square']
  const scale = Math.min(1, 512 / Math.max(dims.w, dims.h))
  return Array.from({ length: Math.max(0, n - completed) }, (_, offset) => {
    const index = offset + completed
    return {
      turnId,
      variantIndex: index,
      ...imageSlotPosition(items, turnId, index),
      w: dims.w * scale,
      h: dims.h * scale,
      title: titles?.[index],
    }
  })
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
  pendingSkeletons: {},

  setProjects: (list) => set({ projects: list }),

  loadSnapshot: (snap) => {
    // Derive activeTurnId from chat: any agent message still marked
    // `streaming` means there's a turn in flight on the server that
    // the UI should consider active (Cancel button, "Thinking…" pill,
    // etc). Without this, a snapshot reload during a live turn —
    // either at boot or after an SSE reconnect — would leave the UI
    // in "no active turn" state while the turn keeps running.
    const streamingAgent = [...snap.chat]
      .reverse()
      .find((m): m is AgentMessage => m.role === 'agent' && m.status === 'streaming')
    const user = snap.chat.find((m) => m.role === 'user' && m.turnId === streamingAgent?.turnId)
    const plan = streamingAgent?.generationPlan
    const slots = streamingAgent ? skeletonSlots(
      snap.items,
      streamingAgent.turnId,
      plan?.images.length ?? (user?.role === 'user' ? user.variantCount : undefined) ?? DEFAULT_IMAGE_COUNT,
      plan?.aspectRatio,
      streamingAgent.producedItemIds.length,
      plan?.images,
    ) : []
    set({
      project: snap.project,
      items: snap.items,
      assets: snap.assets,
      chat: snap.chat,
      selection: new Set(),
      attachedAssetIds: [],
      drawerAssetId: null,
      activeTurnId: streamingAgent?.turnId ?? null,
      pendingSkeletons: streamingAgent && slots.length ? { [streamingAgent.turnId]: slots } : {},
    })
  },

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
      pendingSkeletons: {},
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
        case 'turn.plan': {
          const agent = s.chat.find((m) => m.role === 'agent' && m.turnId === event.turnId)
          if (agent?.role === 'agent' && agent.status !== 'streaming') return s
          const slots = skeletonSlots(s.items, event.turnId, event.plan.images.length, event.plan.aspectRatio,
            agent?.role === 'agent' ? agent.producedItemIds.length : 0, event.plan.images)
          return {
            chat: withAgentMessage(s.chat, event.turnId, { generationPlan: event.plan }),
            pendingSkeletons: { ...s.pendingSkeletons, [event.turnId]: slots },
            camera: s.activeTurnId === event.turnId && slots.length ? fitCameraTo(slots) : s.camera,
          }
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
        case 'turn.completed': {
          const { [event.turnId]: _drop, ...restSkeletons } = s.pendingSkeletons
          return {
            activeTurnId: s.activeTurnId === event.turnId ? null : s.activeTurnId,
            chat: withAgentMessage(s.chat, event.turnId, {
              status: 'completed',
              completedAt: Date.now(),
            }),
            pendingSkeletons: restSkeletons,
          }
        }
        case 'turn.failed': {
          const { [event.turnId]: _drop, ...restSkeletons } = s.pendingSkeletons
          return {
            activeTurnId: s.activeTurnId === event.turnId ? null : s.activeTurnId,
            chat: withAgentMessage(s.chat, event.turnId, {
              status: 'failed',
              error: event.error,
              errorKind: event.errorKind,
            }),
            pendingSkeletons: restSkeletons,
          }
        }
        case 'asset.added':
          return {
            assets: { ...s.assets, [event.asset.id]: event.asset },
          }
        case 'item.added': {
          if (s.items.some((item) => item.id === event.item.id)) return s
          // Consume one skeleton slot for the turn that produced this
          // item, so a tile painting in place replaces its placeholder
          // rather than sitting next to it.
          const turnId = event.item.turnId
          let pendingSkeletons = s.pendingSkeletons
          if (turnId && pendingSkeletons[turnId]?.length) {
            const next = pendingSkeletons[turnId].slice(1)
            pendingSkeletons =
              next.length > 0
                ? { ...pendingSkeletons, [turnId]: next }
                : (() => {
                    const { [turnId]: _drop, ...rest } = pendingSkeletons
                    return rest
                  })()
          }
          return {
            items: [...s.items, event.item], pendingSkeletons,
            chat: s.chat.map((m) => m.role === 'agent' && m.turnId === turnId && !m.producedItemIds.includes(event.item.id)
              ? { ...m, producedItemIds: [...m.producedItemIds, event.item.id] }
              : m),
          }
        }
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

  startPendingSkeletons: (turnId, count, aspectRatio) =>
    set((s) => {
      const slots = skeletonSlots(s.items, turnId, count, aspectRatio)
      return {
        pendingSkeletons: { ...s.pendingSkeletons, [turnId]: slots },
      }
    }),

  clearPendingSkeletons: (turnId) =>
    set((s) => {
      if (!s.pendingSkeletons[turnId]) return s
      const { [turnId]: _drop, ...rest } = s.pendingSkeletons
      return { pendingSkeletons: rest }
    }),
}))

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

import { useCallback, useMemo, useRef } from 'react'
import type { CanvasItem } from '@vissor/shared'
import { useStore } from '../store/store.js'
import { api } from '../lib/api.js'
import { pushHistory } from '../lib/history.js'
import { snap } from '../lib/snap.js'

/**
 * Renders a subtle frame behind every "variant set" — i.e. every
 * group of canvas items that share a turnId.
 *
 * The frame also acts as a drag-handle: clicking the border or the
 * label strip and dragging moves every member of the group together.
 * The body of the frame is pointer-transparent so tile interactions
 * still work through it.
 */
export function VariantFrames(): JSX.Element | null {
  const items = useStore((s) => s.items)
  const chat = useStore((s) => s.chat)

  const groups = useMemo(() => groupByTurn(items), [items])
  if (groups.length === 0) return null

  const labels = new Map<string, string>()
  for (const m of chat) {
    if (m.role === 'user') labels.set(m.turnId, cleanLabel(m.text))
  }

  return (
    <>
      {groups.map((g) => (
        <VariantFrame
          key={g.turnId}
          group={g}
          label={labels.get(g.turnId) ?? ''}
        />
      ))}
    </>
  )
}

interface GroupRect {
  turnId: string
  minX: number
  minY: number
  maxX: number
  maxY: number
  itemIds: string[]
}

function VariantFrame({
  group,
  label,
}: {
  group: GroupRect
  label: string
}): JSX.Element {
  const patchItem = useStore((s) => s.patchItem)
  const project = useStore((s) => s.project)
  const cameraScale = useStore((s) => s.camera.scale)

  const pad = 14
  const labelH = label ? 24 : 0

  const dragState = useRef<{
    pointerId: number
    startClientX: number
    startClientY: number
    snapshots: { id: string; x: number; y: number }[]
    moved: boolean
  } | null>(null)

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      e.stopPropagation()
      const state = useStore.getState()
      const snapshots = group.itemIds
        .map((id) => state.items.find((i) => i.id === id))
        .filter((i): i is CanvasItem => !!i)
        .map((i) => ({ id: i.id, x: i.x, y: i.y }))
      dragState.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        snapshots,
        moved: false,
      }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [group.itemIds],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const ds = dragState.current
      if (!ds || ds.pointerId !== e.pointerId) return
      const dx = (e.clientX - ds.startClientX) / cameraScale
      const dy = (e.clientY - ds.startClientY) / cameraScale
      if (Math.abs(dx) + Math.abs(dy) > 2) ds.moved = true

      // Build a fake AABB for the whole group at its raw dragged
      // position, snap it against items that are NOT in the group.
      const state = useStore.getState()
      const memberIds = new Set(ds.snapshots.map((s) => s.id))
      const others = state.items.filter((i) => !memberIds.has(i.id))
      const startMinX = Math.min(...ds.snapshots.map((s) => s.x))
      const startMinY = Math.min(...ds.snapshots.map((s) => s.y))
      const members = ds.snapshots.map((s) => {
        const cur = state.items.find((i) => i.id === s.id)
        return { w: cur?.w ?? 0, h: cur?.h ?? 0 }
      })
      const startMaxX = Math.max(
        ...ds.snapshots.map((s, i) => s.x + members[i].w),
      )
      const startMaxY = Math.max(
        ...ds.snapshots.map((s, i) => s.y + members[i].h),
      )
      const movingBox = {
        x: startMinX + dx,
        y: startMinY + dy,
        w: startMaxX - startMinX,
        h: startMaxY - startMinY,
      }
      const threshold = 6 / cameraScale
      const result = snap(movingBox, others, threshold)
      const adjustDx = dx + (result.x - movingBox.x)
      const adjustDy = dy + (result.y - movingBox.y)
      state.setGuides(result.guides)
      for (const s of ds.snapshots) {
        patchItem(s.id, { x: s.x + adjustDx, y: s.y + adjustDy })
      }
    },
    [cameraScale, patchItem],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const ds = dragState.current
      if (!ds || ds.pointerId !== e.pointerId) return
      dragState.current = null
      try {
        ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
      } catch {
        // ignore
      }
      // Always clear guides when the drag finishes.
      useStore.getState().setGuides([])
      if (!ds.moved || !project) return
      // Use the current (snapped) positions for both undo and persist.
      const currentItems = useStore.getState().items
      const moves = ds.snapshots
        .map((s) => {
          const cur = currentItems.find((i) => i.id === s.id)
          if (!cur) return null
          return {
            itemId: s.id,
            from: { x: s.x, y: s.y },
            to: { x: cur.x, y: cur.y },
          }
        })
        .filter((m): m is NonNullable<typeof m> => !!m)
      pushHistory({ kind: 'move', moves })
      for (const m of moves) {
        void api.patchItem(project.id, m.itemId, m.to).catch(() => undefined)
      }
    },
    [cameraScale, project],
  )

  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: group.minX - pad,
        top: group.minY - pad - labelH,
        width: group.maxX - group.minX + pad * 2,
        height: group.maxY - group.minY + pad * 2 + labelH,
        pointerEvents: 'none',
      }}
    >
      {/* The visible frame itself — its border is the drag handle. */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 10,
          border: '1px dashed var(--border-strong)',
          background: 'transparent',
          pointerEvents: 'auto',
          // Only the edges should grab; the center must pass clicks to
          // tiles. Use a 20px-wide transparent click-through hole.
          clipPath:
            'polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 20px, 20px 20px, 20px calc(100% - 20px), calc(100% - 20px) calc(100% - 20px), calc(100% - 20px) 20px, 0 20px)',
          cursor: 'grab',
        }}
      />
      {/* Label strip — also a drag handle. */}
      {label && (
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: labelH,
            padding: '4px 14px',
            fontSize: 11,
            color: 'var(--fg-dim)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            pointerEvents: 'auto',
            cursor: 'grab',
          }}
        >
          {label}
        </div>
      )}
    </div>
  )
}

/** Shorten a raw user prompt into something that fits above a group. */
function cleanLabel(raw: string): string {
  const MAX = 60
  // Take up to the first sentence boundary, else the first comma.
  let s = raw.trim()
  const firstSentence = /^([^.!?\n]+[.!?])/.exec(s)
  if (firstSentence) s = firstSentence[1]
  // If it's still long, trim to first comma clause.
  if (s.length > MAX) {
    const firstComma = s.indexOf(',')
    if (firstComma > 10 && firstComma <= MAX) s = s.slice(0, firstComma)
  }
  if (s.length > MAX) s = s.slice(0, MAX - 1).trimEnd() + '…'
  return s
}

function groupByTurn(items: CanvasItem[]): GroupRect[] {
  const map = new Map<string, GroupRect>()
  for (const item of items) {
    if (!item.turnId) continue
    let g = map.get(item.turnId)
    if (!g) {
      g = {
        turnId: item.turnId,
        minX: item.x,
        minY: item.y,
        maxX: item.x + item.w,
        maxY: item.y + item.h,
        itemIds: [item.id],
      }
      map.set(item.turnId, g)
      continue
    }
    g.minX = Math.min(g.minX, item.x)
    g.minY = Math.min(g.minY, item.y)
    g.maxX = Math.max(g.maxX, item.x + item.w)
    g.maxY = Math.max(g.maxY, item.y + item.h)
    g.itemIds.push(item.id)
  }
  return [...map.values()].filter((g) => g.itemIds.length >= 2)
}

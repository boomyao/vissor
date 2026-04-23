import { useCallback, useEffect, useRef, useState } from 'react'
import type { CanvasItem } from '@vissor/shared'
import { useStore } from '../store/store.js'
import { api } from '../lib/api.js'
import { pushHistory } from '../lib/history.js'
import { snap } from '../lib/snap.js'
import { TileMenu } from './TileMenu.js'

interface Props {
  item: CanvasItem
}

/**
 * A single tile on the canvas. Images render via /api/files/:id; text
 * and group items render fallbacks. Drag to reposition; double-click
 * to open the drawer; shift-click to multi-select.
 */
export function CanvasTile({ item }: Props): JSX.Element {
  const selected = useStore((s) => s.selection.has(item.id))
  const assets = useStore((s) => s.assets)
  const project = useStore((s) => s.project)
  const patchItem = useStore((s) => s.patchItem)
  const toggleSelection = useStore((s) => s.toggleSelection)
  const openDrawer = useStore((s) => s.openDrawer)
  const cameraScale = useStore((s) => s.camera.scale)

  const dragState = useRef<{
    pointerId: number
    startClientX: number
    startClientY: number
    startX: number
    startY: number
    moved: boolean
  } | null>(null)

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      e.stopPropagation()
      dragState.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: item.x,
        startY: item.y,
        moved: false,
      }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [item.x, item.y],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const ds = dragState.current
      if (!ds || ds.pointerId !== e.pointerId) return
      const dx = (e.clientX - ds.startClientX) / cameraScale
      const dy = (e.clientY - ds.startClientY) / cameraScale
      if (Math.abs(dx) + Math.abs(dy) > 2) ds.moved = true
      const state = useStore.getState()
      const others = state.items.filter((i) => i.id !== item.id)
      // 6px screen → world threshold; keeps snap feel constant when zoomed.
      const threshold = 6 / cameraScale
      const raw = { x: ds.startX + dx, y: ds.startY + dy, w: item.w, h: item.h }
      const snapped = snap(raw, others, threshold)
      state.setGuides(snapped.guides)
      patchItem(item.id, { x: snapped.x, y: snapped.y })
    },
    [cameraScale, item.id, item.w, item.h, patchItem],
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
      // Drag is over — clear any snap guides from the store.
      useStore.getState().setGuides([])
      if (!ds.moved) {
        toggleSelection(item.id, e.shiftKey)
        return
      }
      // Persist final position to the server + record for undo. Use
      // the current item's position from the store so snapping is
      // preserved; recomputing the raw delta would undo the snap.
      if (project) {
        const current = useStore
          .getState()
          .items.find((i) => i.id === item.id)
        if (!current) return
        const to = { x: current.x, y: current.y }
        pushHistory({
          kind: 'move',
          moves: [{ itemId: item.id, from: { x: ds.startX, y: ds.startY }, to }],
        })
        void api.patchItem(project.id, item.id, to).catch(() => {
          // server will reconcile via SSE if it rejects
        })
      }
    },
    [item.id, project, toggleSelection],
  )

  const [editingText, setEditingText] = useState(false)
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null)

  // Listen for `vissor:edit-text` events addressed to our id — the
  // Canvas dispatches these when it creates a fresh text tile so
  // the tile immediately enters edit mode.
  useEffect(() => {
    if (item.kind !== 'text') return
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ itemId: string }>).detail
      if (detail?.itemId === item.id) setEditingText(true)
    }
    window.addEventListener('vissor:edit-text', handler as EventListener)
    return () =>
      window.removeEventListener('vissor:edit-text', handler as EventListener)
  }, [item.id, item.kind])

  // Autofocus the textarea once we enter edit mode.
  useEffect(() => {
    if (editingText) textAreaRef.current?.focus()
  }, [editingText])

  const onDoubleClick = useCallback(() => {
    if (item.kind === 'image') openDrawer(item.assetId)
    else if (item.kind === 'text') setEditingText(true)
  }, [item, openDrawer])

  const commitText = useCallback(
    async (nextText: string) => {
      if (item.kind !== 'text') return
      if (nextText === item.text) {
        setEditingText(false)
        return
      }
      if (project) {
        // Optimistic local update, then persist.
        patchItem(item.id, { text: nextText } as Partial<CanvasItem>)
        try {
          await api.patchText(project.id, item.id, nextText)
        } catch {
          // server will reconcile
        }
      }
      setEditingText(false)
    },
    [item, patchItem, project],
  )

  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setMenuPos({ x: e.clientX, y: e.clientY })
  }, [])

  const style: React.CSSProperties = {
    position: 'absolute',
    left: item.x,
    top: item.y,
    width: item.w,
    height: item.h,
    borderRadius: 12,
    overflow: 'hidden',
    background: 'var(--bg-elev)',
    border: selected
      ? '2px solid var(--accent)'
      : '1px solid var(--border)',
    boxShadow: selected
      ? '0 0 0 2px rgba(13, 153, 255, 0.25), var(--shadow-sm)'
      : 'var(--shadow-sm)',
    cursor: 'grab',
    userSelect: 'none',
    touchAction: 'none',
  }

  return (
    <div
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      {item.kind === 'image' && assets[item.assetId] && (
        <img
          src={api.fileUrl(item.assetId)}
          alt=""
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            pointerEvents: 'none',
          }}
        />
      )}
      {item.kind === 'text' && !editingText && (
        <div
          style={{
            padding: 16,
            color: item.text ? (item.color ?? 'var(--fg)') : 'var(--fg-dim)',
            fontSize: item.fontSize ?? 16,
            lineHeight: 1.35,
            whiteSpace: 'pre-wrap',
            fontStyle: item.text ? 'normal' : 'italic',
            height: '100%',
            boxSizing: 'border-box',
          }}
        >
          {item.text || 'Double-click to edit'}
        </div>
      )}
      {item.kind === 'text' && editingText && (
        <textarea
          ref={textAreaRef}
          defaultValue={item.text}
          onBlur={(e) => void commitText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              void commitText(e.currentTarget.value)
            }
          }}
          style={{
            width: '100%',
            height: '100%',
            padding: 16,
            boxSizing: 'border-box',
            border: 'none',
            background: 'transparent',
            color: item.color ?? 'var(--fg)',
            fontSize: item.fontSize ?? 16,
            lineHeight: 1.35,
            resize: 'none',
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />
      )}
      {item.kind === 'group' && (
        <div
          style={{
            padding: 16,
            color: 'var(--fg-dim)',
            fontSize: 12,
          }}
        >
          Group {item.label ? `· ${item.label}` : ''}
        </div>
      )}
      {selected && item.kind === 'image' && (
        <ResizeHandles item={item} />
      )}
      {selected && item.kind === 'text' && !editingText && (
        <TextStyleToolbar item={item} />
      )}
      {menuPos && (
        <TileMenu
          item={item}
          x={menuPos.x}
          y={menuPos.y}
          onClose={() => setMenuPos(null)}
        />
      )}
    </div>
  )
}

interface ResizeHandlesProps {
  item: Extract<CanvasItem, { kind: 'image' }>
}

const HANDLE_CORNERS = ['tl', 'tr', 'bl', 'br'] as const
type Corner = (typeof HANDLE_CORNERS)[number]

const TEXT_SIZE_PRESETS: { label: string; value: number }[] = [
  { label: 'S', value: 12 },
  { label: 'M', value: 16 },
  { label: 'L', value: 24 },
  { label: 'XL', value: 40 },
]
const TEXT_COLOR_PRESETS: string[] = [
  '#1E1E1E', // near-black, theme fg
  '#FFFFFF', // white (on dark bg)
  '#0D99FF', // accent blue
  '#E03E3E', // red
  '#10A97C', // green
  '#9B51E0', // purple
]

/**
 * Inline toolbar pinned just above a selected text tile. Lets the
 * user pick a size preset or colour swatch without opening a modal.
 * Rendered inside the tile's transformed container, so it scales
 * with the camera — we compensate by dividing offsets by
 * camera.scale so hit targets stay clickable.
 */
function TextStyleToolbar({
  item,
}: {
  item: Extract<CanvasItem, { kind: 'text' }>
}): JSX.Element {
  const project = useStore((s) => s.project)
  const patchItemLocal = useStore((s) => s.patchItem)
  const cameraScale = useStore((s) => s.camera.scale)

  const apply = (patch: Partial<CanvasItem>): void => {
    patchItemLocal(item.id, patch)
    if (project) {
      void api
        .patchItem(project.id, item.id, patch as {
          fontSize?: number
          color?: string
        })
        .catch(() => undefined)
    }
  }

  // Counter-scale so the toolbar stays at a constant screen size
  // regardless of zoom. Without this it shrinks to invisibility at
  // 20% zoom and overwhelms the tile at 400% zoom.
  const scale = 1 / cameraScale

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        transform: `translate(0, -${40 * scale + 4}px) scale(${scale})`,
        transformOrigin: 'top left',
        display: 'flex',
        gap: 2,
        padding: 4,
        background: 'var(--bg-elev)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow-lg)',
        zIndex: 6,
        whiteSpace: 'nowrap',
      }}
    >
      {TEXT_SIZE_PRESETS.map((p) => {
        const active = (item.fontSize ?? 16) === p.value
        return (
          <button
            key={p.value}
            type="button"
            onClick={() => apply({ fontSize: p.value })}
            style={{
              padding: '4px 8px',
              fontSize: 12,
              background: active ? 'var(--bg-elev-2)' : 'transparent',
              color: 'var(--fg)',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
            title={`Size ${p.value}px`}
          >
            {p.label}
          </button>
        )
      })}
      <span style={{ width: 1, background: 'var(--border)', margin: '2px 4px' }} />
      {TEXT_COLOR_PRESETS.map((c) => {
        const active = (item.color ?? '#1E1E1E').toLowerCase() === c.toLowerCase()
        return (
          <button
            key={c}
            type="button"
            onClick={() => apply({ color: c })}
            style={{
              width: 20,
              height: 20,
              padding: 0,
              background: c,
              border: active
                ? '2px solid var(--accent)'
                : '1px solid var(--border)',
              borderRadius: '50%',
              cursor: 'pointer',
            }}
            title={c}
          />
        )
      })}
    </div>
  )
}

function ResizeHandles({ item }: ResizeHandlesProps): JSX.Element {
  const cameraScale = useStore((s) => s.camera.scale)
  const project = useStore((s) => s.project)
  const patchItem = useStore((s) => s.patchItem)
  const resizing = useRef<{
    pointerId: number
    corner: Corner
    startClientX: number
    startClientY: number
    from: { x: number; y: number; w: number; h: number }
  } | null>(null)

  const handleSize = 10

  const begin = (corner: Corner) =>
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      e.stopPropagation()
      resizing.current = {
        pointerId: e.pointerId,
        corner,
        startClientX: e.clientX,
        startClientY: e.clientY,
        from: { x: item.x, y: item.y, w: item.w, h: item.h },
      }
      try {
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      } catch {
        // ignore
      }
    }

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = resizing.current
    if (!r || r.pointerId !== e.pointerId) return
    e.stopPropagation()
    const dx = (e.clientX - r.startClientX) / cameraScale
    const dy = (e.clientY - r.startClientY) / cameraScale
    let { x, y, w, h } = r.from
    if (r.corner === 'br') {
      w = Math.max(40, r.from.w + dx)
      h = Math.max(40, r.from.h + dy)
    } else if (r.corner === 'tr') {
      w = Math.max(40, r.from.w + dx)
      h = Math.max(40, r.from.h - dy)
      y = r.from.y + (r.from.h - h)
    } else if (r.corner === 'bl') {
      w = Math.max(40, r.from.w - dx)
      h = Math.max(40, r.from.h + dy)
      x = r.from.x + (r.from.w - w)
    } else {
      // tl
      w = Math.max(40, r.from.w - dx)
      h = Math.max(40, r.from.h - dy)
      x = r.from.x + (r.from.w - w)
      y = r.from.y + (r.from.h - h)
    }
    // Shift = lock aspect ratio to original.
    if (e.shiftKey) {
      const aspect = r.from.w / r.from.h
      // Pick the axis that moved more to drive the lock.
      if (Math.abs(dx) > Math.abs(dy)) h = w / aspect
      else w = h * aspect
      if (r.corner === 'tl' || r.corner === 'bl')
        x = r.from.x + (r.from.w - w)
      if (r.corner === 'tl' || r.corner === 'tr')
        y = r.from.y + (r.from.h - h)
    }
    patchItem(item.id, { x, y, w, h })
  }

  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = resizing.current
    if (!r || r.pointerId !== e.pointerId) return
    e.stopPropagation()
    resizing.current = null
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    if (!project) return
    const current = useStore.getState().items.find((i) => i.id === item.id)
    if (!current) return
    void api
      .patchItem(project.id, item.id, {
        x: current.x,
        y: current.y,
        w: current.w,
        h: current.h,
      })
      .catch(() => undefined)
  }

  const cornerStyle = (corner: Corner): React.CSSProperties => {
    const half = handleSize / 2
    const common: React.CSSProperties = {
      position: 'absolute',
      width: handleSize,
      height: handleSize,
      background: 'var(--accent)',
      border: '1px solid white',
      borderRadius: 2,
      pointerEvents: 'auto',
    }
    if (corner === 'tl') return { ...common, left: -half, top: -half, cursor: 'nwse-resize' }
    if (corner === 'tr') return { ...common, right: -half, top: -half, cursor: 'nesw-resize' }
    if (corner === 'bl') return { ...common, left: -half, bottom: -half, cursor: 'nesw-resize' }
    return { ...common, right: -half, bottom: -half, cursor: 'nwse-resize' }
  }

  return (
    <>
      {HANDLE_CORNERS.map((c) => (
        <div
          key={c}
          onPointerDown={begin(c)}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          style={cornerStyle(c)}
        />
      ))}
    </>
  )
}

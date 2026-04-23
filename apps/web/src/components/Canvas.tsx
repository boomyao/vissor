import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store/store.js'
import { CanvasTile } from './CanvasTile.js'
import { VariantFrames } from './VariantFrames.js'
import { api } from '../lib/api.js'
import { fitCameraTo } from '../lib/camera.js'
import { pushHistory } from '../lib/history.js'

/**
 * Infinite pan/zoom board. World-space tiles are rendered inside a
 * transformed container; the wrapper takes wheel + drag events and
 * updates camera state in the store.
 *
 * UX:
 *   - Space+drag OR middle-button-drag = pan (same as Figma)
 *   - Mousewheel = zoom (pinch on trackpad = zoom; two-finger drag = pan)
 *   - Click empty space = clear selection
 */
export function Canvas(): JSX.Element {
  const camera = useStore((s) => s.camera)
  const items = useStore((s) => s.items)
  const panBy = useStore((s) => s.panBy)
  const zoomAt = useStore((s) => s.zoomAt)
  const clearSelection = useStore((s) => s.clearSelection)

  const rootRef = useRef<HTMLDivElement>(null)
  const spaceDown = useRef(false)
  const dragging = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  type MarqueeState = {
    originClientX: number
    originClientY: number
    clientX: number
    clientY: number
    additive: boolean
  }
  // Use a ref as the source of truth so back-to-back pointer events
  // (including synthetic ones dispatched in tests) see up-to-date
  // values without waiting on React's render cycle. The useState call
  // is there purely to force re-render when the marquee changes.
  const marqueeRef = useRef<MarqueeState | null>(null)
  const [marquee, setMarqueeState] = useState<MarqueeState | null>(null)
  const setMarquee = useCallback((next: MarqueeState | null) => {
    marqueeRef.current = next
    setMarqueeState(next)
  }, [])

  // Burst state for arrow-key nudges. We snapshot the starting
  // positions of each selected item when a burst begins, then debounce
  // a single history + persist at burst end.
  const nudgeBurst = useRef<{
    starts: Map<string, { x: number; y: number }>
    timer: ReturnType<typeof setTimeout> | null
  } | null>(null)

  const commitNudge = useCallback(() => {
    const burst = nudgeBurst.current
    if (!burst) return
    if (burst.timer) clearTimeout(burst.timer)
    nudgeBurst.current = null
    const { project, items: allItems } = useStore.getState()
    if (!project) return
    const moves: { itemId: string; from: { x: number; y: number }; to: { x: number; y: number } }[] = []
    for (const [itemId, from] of burst.starts) {
      const cur = allItems.find((i) => i.id === itemId)
      if (!cur) continue
      if (cur.x === from.x && cur.y === from.y) continue
      moves.push({ itemId, from, to: { x: cur.x, y: cur.y } })
    }
    if (moves.length === 0) return
    pushHistory({ kind: 'move', moves })
    for (const m of moves) {
      void api.patchItem(project.id, m.itemId, m.to).catch(() => undefined)
    }
  }, [])

  // Keyboard state — space toggles pan-grab; Delete/Backspace removes selection.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      if (e.code === 'Space') {
        spaceDown.current = true
        if (rootRef.current) rootRef.current.style.cursor = 'grab'
        e.preventDefault()
      } else if (e.code === 'Delete' || e.code === 'Backspace') {
        const { selection, project, items } = useStore.getState()
        if (!project || selection.size === 0) return
        e.preventDefault()
        const toDelete = items.filter((i) => selection.has(i.id))
        if (toDelete.length) {
          pushHistory({ kind: 'delete', items: toDelete })
        }
        for (const item of toDelete) {
          useStore.setState((s) => ({
            items: s.items.filter((i) => i.id !== item.id),
            selection: new Set(),
          }))
          void api.deleteItem(project.id, item.id).catch(() => undefined)
        }
      } else if (e.code === 'Escape') {
        useStore.getState().clearSelection()
        useStore.getState().openDrawer(null)
      } else if (
        e.code === 'ArrowLeft' ||
        e.code === 'ArrowRight' ||
        e.code === 'ArrowUp' ||
        e.code === 'ArrowDown'
      ) {
        const { selection, items: allItems } = useStore.getState()
        if (selection.size === 0) return
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx =
          e.code === 'ArrowLeft' ? -step : e.code === 'ArrowRight' ? step : 0
        const dy =
          e.code === 'ArrowUp' ? -step : e.code === 'ArrowDown' ? step : 0
        // Start a new burst if one isn't in flight, capturing starts.
        if (!nudgeBurst.current) {
          const starts = new Map<string, { x: number; y: number }>()
          for (const id of selection) {
            const it = allItems.find((i) => i.id === id)
            if (it) starts.set(id, { x: it.x, y: it.y })
          }
          nudgeBurst.current = { starts, timer: null }
        }
        // Apply the nudge optimistically.
        for (const id of selection) {
          const it = allItems.find((i) => i.id === id)
          if (!it) continue
          useStore.getState().patchItem(id, { x: it.x + dx, y: it.y + dy })
        }
        // Debounce commit.
        if (nudgeBurst.current.timer) clearTimeout(nudgeBurst.current.timer)
        nudgeBurst.current.timer = setTimeout(commitNudge, 300)
      } else if (e.code === 'KeyR' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Attach selected image tiles' assets to the compose tray so the
        // next turn treats them as reference images.
        const state = useStore.getState()
        if (state.selection.size === 0) return
        e.preventDefault()
        let attachedAny = false
        for (const itemId of state.selection) {
          const item = state.items.find((i) => i.id === itemId)
          if (item?.kind === 'image') {
            state.attachAsset(item.assetId)
            attachedAny = true
          }
        }
        if (!attachedAny) {
          // Non-image selection: no-op, don't steal the keystroke silently.
          // Still consumed to match the "selection hotkey" expectation.
        }
      } else if (e.code === 'KeyF' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Fit-to-content shortcut, matching the Fit button in TopBar.
        e.preventDefault()
        const state = useStore.getState()
        state.setCamera(fitCameraTo(state.items))
      } else if (e.code === 'KeyT' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Text tool — create a text tile at the centre of the current
        // viewport in world space and immediately enter edit mode.
        e.preventDefault()
        const { project, camera } = useStore.getState()
        if (!project) return
        const vw = window.innerWidth
        const vh = window.innerHeight
        const worldX = (vw / 2 - camera.x) / camera.scale - 120
        const worldY = (vh / 2 - camera.y) / camera.scale - 20
        void (async () => {
          try {
            const { item } = await api.placeText(
              project.id,
              worldX,
              worldY,
              '',
            )
            window.dispatchEvent(
              new CustomEvent('vissor:edit-text', {
                detail: { itemId: item.id },
              }),
            )
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('placeText (T key) failed', err)
          }
        })()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDown.current = false
        if (rootRef.current && !dragging.current) {
          rootRef.current.style.cursor = ''
        }
      }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      // Ctrl/Cmd + wheel, or pinch-gestures (ctrlKey is set) => zoom.
      // Otherwise pan. This matches Figma/Lovart.
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const factor = Math.exp(-e.deltaY * 0.002)
        zoomAt(e.clientX, e.clientY, factor)
      } else {
        panBy(-e.deltaX, -e.deltaY)
      }
    },
    [panBy, zoomAt],
  )

  // Vite React fast-refresh doesn't honor passive wheel via JSX — attach manually.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault()
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const targetIsEmpty = e.target === e.currentTarget
      const canPan = spaceDown.current || e.button === 1
      if (canPan) {
        e.preventDefault()
        dragging.current = true
        last.current = { x: e.clientX, y: e.clientY }
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        e.currentTarget.style.cursor = 'grabbing'
      } else if (targetIsEmpty && e.button === 0) {
        // Start a marquee selection. If the user releases without
        // moving the pointer, the marquee resolves to a plain "clear
        // selection" click (handled on pointer-up). setPointerCapture
        // can throw when the event isn't fully valid (e.g. simulated
        // in tests), so swallow and let the flow continue.
        try {
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        } catch {
          // ignore
        }
        setMarquee({
          originClientX: e.clientX,
          originClientY: e.clientY,
          clientX: e.clientX,
          clientY: e.clientY,
          additive: e.shiftKey,
        })
      }
    },
    [setMarquee],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragging.current && last.current) {
        const dx = e.clientX - last.current.x
        const dy = e.clientY - last.current.y
        last.current = { x: e.clientX, y: e.clientY }
        panBy(dx, dy)
        return
      }
      if (marqueeRef.current) {
        setMarquee({
          ...marqueeRef.current,
          clientX: e.clientX,
          clientY: e.clientY,
        })
      }
    },
    [panBy, setMarquee],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragging.current) {
        dragging.current = false
        last.current = null
        try {
          ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
        } catch {
          // ignore
        }
        e.currentTarget.style.cursor = spaceDown.current ? 'grab' : ''
        return
      }
      const m = marqueeRef.current
      if (!m) return
      try {
        ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
      } catch {
        // ignore
      }
      const dx = Math.abs(e.clientX - m.originClientX)
      const dy = Math.abs(e.clientY - m.originClientY)
      if (dx < 3 && dy < 3) {
        // No meaningful drag → treat as a plain click on empty area.
        if (!m.additive) clearSelection()
        setMarquee(null)
        return
      }
      // Convert marquee (in screen space) to world space, then select
      // every tile whose bounding box overlaps.
      const rootRect = rootRef.current?.getBoundingClientRect()
      if (!rootRect) {
        setMarquee(null)
        return
      }
      const { camera } = useStore.getState()
      const screenX0 = Math.min(m.originClientX, e.clientX) - rootRect.left
      const screenY0 = Math.min(m.originClientY, e.clientY) - rootRect.top
      const screenX1 = Math.max(m.originClientX, e.clientX) - rootRect.left
      const screenY1 = Math.max(m.originClientY, e.clientY) - rootRect.top
      const worldX0 = (screenX0 - camera.x) / camera.scale
      const worldY0 = (screenY0 - camera.y) / camera.scale
      const worldX1 = (screenX1 - camera.x) / camera.scale
      const worldY1 = (screenY1 - camera.y) / camera.scale
      const { items } = useStore.getState()
      const hits = items.filter(
        (it) =>
          it.x + it.w >= worldX0 &&
          it.x <= worldX1 &&
          it.y + it.h >= worldY0 &&
          it.y <= worldY1,
      )
      useStore.setState((state) => {
        const next = m.additive ? new Set(state.selection) : new Set<string>()
        for (const h of hits) next.add(h.id)
        return { selection: next }
      })
      setMarquee(null)
    },
    [clearSelection, setMarquee],
  )

  const [dragOver, setDragOver] = useState(false)

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    // Fires when dragging onto a child; only clear if we're leaving the root.
    if (e.currentTarget === e.target) setDragOver(false)
  }, [])

  const onDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setDragOver(false)
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith('image/'),
      )
      if (files.length === 0) return
      const { project, camera } = useStore.getState()
      if (!project) return
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const worldX = (e.clientX - rect.left - camera.x) / camera.scale
      const worldY = (e.clientY - rect.top - camera.y) / camera.scale
      // Probe intrinsic dimensions client-side so the tile matches the
      // image's native aspect ratio.
      const dims = await Promise.all(files.map(readImageSize))
      try {
        const beforeIds = new Set(useStore.getState().items.map((i) => i.id))
        const { assets } = await api.upload(project.id, files)
        const GAP = 16
        let cursorX = worldX
        for (let i = 0; i < assets.length; i++) {
          const a = assets[i]
          const d = dims[i] ?? { w: 320, h: 320 }
          const scale = Math.min(1, 512 / Math.max(d.w, d.h))
          const w = Math.round(d.w * scale)
          const h = Math.round(d.h * scale)
          await api.placeAsset(project.id, a.id, cursorX, worldY, { w, h })
          cursorX += w + GAP
        }
        // Wait a beat for SSE to land the new items, then record an
        // `add` entry covering every newly-created tile.
        setTimeout(() => {
          const newItems = useStore
            .getState()
            .items.filter((i) => !beforeIds.has(i.id))
          if (newItems.length) pushHistory({ kind: 'add', items: newItems })
        }, 300)
      } catch (err) {
        // eslint-disable-next-line no-alert
        alert(`Upload failed: ${err}`)
      }
    },
    [],
  )

  const onDoubleClick = useCallback(
    async (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return
      const { project, camera } = useStore.getState()
      if (!project) return
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const worldX = (e.clientX - rect.left - camera.x) / camera.scale
      const worldY = (e.clientY - rect.top - camera.y) / camera.scale
      try {
        const { item } = await api.placeText(project.id, worldX, worldY, '')
        // Queue this id for auto-edit on mount (see CanvasTile).
        window.dispatchEvent(
          new CustomEvent('vissor:edit-text', { detail: { itemId: item.id } }),
        )
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('placeText failed', err)
      }
    },
    [],
  )

  return (
    <div
      ref={rootRef}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: 'var(--bg)',
        touchAction: 'none',
      }}
    >
      {/* Grid background — subtle dot pattern in world space. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          backgroundImage:
            'radial-gradient(circle, rgba(0,0,0,0.07) 1px, transparent 1px)',
          backgroundSize: `${32 * camera.scale}px ${32 * camera.scale}px`,
          backgroundPosition: `${camera.x}px ${camera.y}px`,
        }}
      />
      {/* World layer. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          transformOrigin: '0 0',
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
          willChange: 'transform',
        }}
      >
        <VariantFrames />
        {[...items]
          .sort((a, b) => a.z - b.z)
          .map((item) => (
            <CanvasTile key={item.id} item={item} />
          ))}
        <SnapGuides />
      </div>
      {dragOver && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 12,
            pointerEvents: 'none',
            border: '2px dashed var(--accent)',
            borderRadius: 'var(--radius-lg)',
            background: 'rgba(13, 153, 255, 0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent-2)',
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: 0.5,
          }}
        >
          Drop images to add them to the canvas
        </div>
      )}
      {marquee && (() => {
        const rect = rootRef.current?.getBoundingClientRect()
        if (!rect) return null
        const x = Math.min(marquee.originClientX, marquee.clientX) - rect.left
        const y = Math.min(marquee.originClientY, marquee.clientY) - rect.top
        const w = Math.abs(marquee.clientX - marquee.originClientX)
        const h = Math.abs(marquee.clientY - marquee.originClientY)
        if (w < 2 && h < 2) return null
        return (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: w,
              height: h,
              border: '1px solid var(--accent)',
              background: 'rgba(13, 153, 255, 0.08)',
              pointerEvents: 'none',
              borderRadius: 2,
            }}
          />
        )
      })()}
    </div>
  )
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    target.isContentEditable
  )
}

function SnapGuides(): JSX.Element | null {
  const guides = useStore((s) => s.activeGuides)
  if (guides.length === 0) return null
  return (
    <>
      {guides.map((g, idx) => {
        if (g.axis === 'x') {
          return (
            <div
              key={idx}
              aria-hidden
              style={{
                position: 'absolute',
                left: g.value,
                top: g.y0,
                width: 0,
                height: g.y1 - g.y0,
                borderLeft: '1px dashed var(--danger)',
                pointerEvents: 'none',
              }}
            />
          )
        }
        return (
          <div
            key={idx}
            aria-hidden
            style={{
              position: 'absolute',
              left: g.x0,
              top: g.value,
              width: g.x1 - g.x0,
              height: 0,
              borderTop: '1px dashed var(--danger)',
              pointerEvents: 'none',
            }}
          />
        )
      })}
    </>
  )
}

function readImageSize(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight })
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      resolve({ w: 320, h: 320 })
      URL.revokeObjectURL(url)
    }
    img.src = url
  })
}

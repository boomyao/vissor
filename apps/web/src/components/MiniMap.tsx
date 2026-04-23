import { useCallback, useMemo } from 'react'
import { useStore } from '../store/store.js'

const MAP_W = 180
const MAP_H = 120
const MAP_PAD = 20 // world-space padding around content bounds

/**
 * Small bottom-right overview of the whole project. Shows every
 * canvas item as a tiny rectangle and overlays the current viewport.
 *
 * Click anywhere on the map to recentre the camera on that world
 * point (viewport width/height are preserved). Hidden when the
 * canvas is empty — it would just be a blank box.
 */
export function MiniMap(): JSX.Element | null {
  const items = useStore((s) => s.items)
  const camera = useStore((s) => s.camera)
  const setCamera = useStore((s) => s.setCamera)

  const bounds = useMemo(() => {
    if (items.length === 0) return null
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const i of items) {
      minX = Math.min(minX, i.x)
      minY = Math.min(minY, i.y)
      maxX = Math.max(maxX, i.x + i.w)
      maxY = Math.max(maxY, i.y + i.h)
    }
    // Include the current viewport in bounds so the viewport frame
    // stays visible when the user has panned outside the content.
    const vw = window.innerWidth
    const vh = window.innerHeight
    const viewMinX = (0 - camera.x) / camera.scale
    const viewMinY = (0 - camera.y) / camera.scale
    const viewMaxX = (vw - camera.x) / camera.scale
    const viewMaxY = (vh - camera.y) / camera.scale
    minX = Math.min(minX, viewMinX) - MAP_PAD
    minY = Math.min(minY, viewMinY) - MAP_PAD
    maxX = Math.max(maxX, viewMaxX) + MAP_PAD
    maxY = Math.max(maxY, viewMaxY) + MAP_PAD
    return { minX, minY, maxX, maxY }
  }, [items, camera])

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!bounds) return
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const mapX = e.clientX - rect.left
      const mapY = e.clientY - rect.top
      const { minX, minY, maxX, maxY } = bounds
      const wWorld = maxX - minX
      const hWorld = maxY - minY
      const scale = Math.min(MAP_W / wWorld, MAP_H / hWorld)
      // Invert the map->world transform.
      const offsetX = (MAP_W - wWorld * scale) / 2
      const offsetY = (MAP_H - hWorld * scale) / 2
      const worldX = (mapX - offsetX) / scale + minX
      const worldY = (mapY - offsetY) / scale + minY
      // Center the camera on the clicked world point.
      const vw = window.innerWidth
      const vh = window.innerHeight
      setCamera({
        x: vw / 2 - worldX * camera.scale,
        y: vh / 2 - worldY * camera.scale,
        scale: camera.scale,
      })
    },
    [bounds, camera.scale, setCamera],
  )

  if (!bounds) return null

  const { minX, minY, maxX, maxY } = bounds
  const wWorld = maxX - minX
  const hWorld = maxY - minY
  const scale = Math.min(MAP_W / wWorld, MAP_H / hWorld)
  const offsetX = (MAP_W - wWorld * scale) / 2
  const offsetY = (MAP_H - hWorld * scale) / 2

  const project = (x: number, y: number) => ({
    left: (x - minX) * scale + offsetX,
    top: (y - minY) * scale + offsetY,
  })

  // Current viewport rect in world space.
  const vw = window.innerWidth
  const vh = window.innerHeight
  const viewX = (0 - camera.x) / camera.scale
  const viewY = (0 - camera.y) / camera.scale
  const viewW = vw / camera.scale
  const viewH = vh / camera.scale

  return (
    <div
      onClick={onClick}
      style={{
        position: 'absolute',
        right: 12,
        bottom: 120,
        width: MAP_W,
        height: MAP_H,
        background: 'var(--bg-elev)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        boxShadow: 'var(--shadow-lg)',
        zIndex: 4,
        cursor: 'pointer',
      }}
      title="Mini-map — click to recentre"
    >
      {items.map((item) => {
        const tl = project(item.x, item.y)
        return (
          <div
            key={item.id}
            aria-hidden
            style={{
              position: 'absolute',
              left: tl.left,
              top: tl.top,
              width: Math.max(2, item.w * scale),
              height: Math.max(2, item.h * scale),
              background:
                item.kind === 'image'
                  ? 'var(--accent)'
                  : 'var(--fg-dim)',
              borderRadius: 1,
              opacity: 0.7,
            }}
          />
        )
      })}
      {(() => {
        const tl = project(viewX, viewY)
        return (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: tl.left,
              top: tl.top,
              width: Math.max(2, viewW * scale),
              height: Math.max(2, viewH * scale),
              border: '1px solid var(--accent)',
              background: 'rgba(13, 153, 255, 0.08)',
              pointerEvents: 'none',
            }}
          />
        )
      })()}
    </div>
  )
}

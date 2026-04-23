import type { CanvasItem } from '@vissor/shared'
import type { Camera } from '../store/store.js'

/**
 * Pick a camera that frames the given items with some padding. With no
 * items we return the identity camera so the welcome hero renders at 0,0.
 */
export function fitCameraTo(
  items: CanvasItem[],
  viewport?: { w: number; h: number },
): Camera {
  const vw = viewport?.w ?? window.innerWidth
  const vh = viewport?.h ?? window.innerHeight
  if (items.length === 0) {
    return { x: 0, y: 0, scale: 1 }
  }
  const minX = Math.min(...items.map((i) => i.x))
  const minY = Math.min(...items.map((i) => i.y))
  const maxX = Math.max(...items.map((i) => i.x + i.w))
  const maxY = Math.max(...items.map((i) => i.y + i.h))
  const bw = Math.max(1, maxX - minX)
  const bh = Math.max(1, maxY - minY)
  // Leave room for the command bar (bottom ~160px) and the top bar (top ~60px).
  const padX = 120
  const padTop = 80
  const padBottom = 180
  const availableW = Math.max(240, vw - padX * 2)
  const availableH = Math.max(240, vh - padTop - padBottom)
  const scale = Math.min(1, availableW / bw, availableH / bh)
  // Center the bounding box inside the available area.
  const worldCx = minX + bw / 2
  const worldCy = minY + bh / 2
  const screenCx = padX + availableW / 2
  const screenCy = padTop + availableH / 2
  const x = screenCx - worldCx * scale
  const y = screenCy - worldCy * scale
  return { x, y, scale }
}

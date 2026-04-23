import type { CanvasItem } from '@vissor/shared'

/**
 * Simple 2D snap: given a tile's current world-space box and a list
 * of sibling tiles, return an adjusted (x, y) that snaps to the
 * closest sibling edge / center within the threshold. Also returns
 * the guide lines (if any) that fired — the caller can render these
 * while the drag is in progress.
 *
 * Threshold is in world-space units; scale by the camera if you want
 * a screen-space feel (e.g. pass `6 / camera.scale`).
 */
export interface SnapResult {
  x: number
  y: number
  guides: SnapGuide[]
}

export type SnapGuide =
  | { axis: 'x'; value: number; y0: number; y1: number }
  | { axis: 'y'; value: number; x0: number; x1: number }

interface Box {
  x: number
  y: number
  w: number
  h: number
}

export function snap(
  moving: Box,
  others: CanvasItem[],
  threshold: number,
): SnapResult {
  const guides: SnapGuide[] = []
  const xGuides: { value: number; y0: number; y1: number }[] = []
  const yGuides: { value: number; x0: number; x1: number }[] = []
  for (const o of others) {
    xGuides.push(
      { value: o.x, y0: o.y, y1: o.y + o.h },
      { value: o.x + o.w / 2, y0: o.y, y1: o.y + o.h },
      { value: o.x + o.w, y0: o.y, y1: o.y + o.h },
    )
    yGuides.push(
      { value: o.y, x0: o.x, x1: o.x + o.w },
      { value: o.y + o.h / 2, x0: o.x, x1: o.x + o.w },
      { value: o.y + o.h, x0: o.x, x1: o.x + o.w },
    )
  }

  const { value: snappedXOrigin, guide: xGuide } = nearest(
    [moving.x, moving.x + moving.w / 2, moving.x + moving.w],
    xGuides,
    threshold,
  )
  let x = moving.x
  if (xGuide && snappedXOrigin !== undefined) {
    // Derive the tile's new x from which edge snapped.
    const [l, c, r] = [moving.x, moving.x + moving.w / 2, moving.x + moving.w]
    if (snappedXOrigin === l) x = xGuide.value
    else if (snappedXOrigin === c) x = xGuide.value - moving.w / 2
    else if (snappedXOrigin === r) x = xGuide.value - moving.w
    // Extend the guide vertically across both tiles.
    const y0 = Math.min(xGuide.y0, moving.y)
    const y1 = Math.max(xGuide.y1, moving.y + moving.h)
    guides.push({ axis: 'x', value: xGuide.value, y0, y1 })
  }

  const { value: snappedYOrigin, guide: yGuide } = nearest(
    [moving.y, moving.y + moving.h / 2, moving.y + moving.h],
    yGuides,
    threshold,
  )
  let y = moving.y
  if (yGuide && snappedYOrigin !== undefined) {
    const [t, m, b] = [moving.y, moving.y + moving.h / 2, moving.y + moving.h]
    if (snappedYOrigin === t) y = yGuide.value
    else if (snappedYOrigin === m) y = yGuide.value - moving.h / 2
    else if (snappedYOrigin === b) y = yGuide.value - moving.h
    const x0 = Math.min(yGuide.x0, x)
    const x1 = Math.max(yGuide.x1, x + moving.w)
    guides.push({ axis: 'y', value: yGuide.value, x0, x1 })
  }

  return { x, y, guides }
}

function nearest<T extends { value: number }>(
  candidates: number[],
  guides: T[],
  threshold: number,
): { value: number | undefined; guide: T | undefined } {
  let best: { value: number; guide: T; dist: number } | null = null
  for (const c of candidates) {
    for (const g of guides) {
      const dist = Math.abs(c - g.value)
      if (dist <= threshold && (!best || dist < best.dist)) {
        best = { value: c, guide: g, dist }
      }
    }
  }
  return best
    ? { value: best.value, guide: best.guide }
    : { value: undefined, guide: undefined }
}

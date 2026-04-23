import type { CanvasItem } from '@vissor/shared'

export type Axis = 'x' | 'y'
export type AlignEdge = 'start' | 'center' | 'end'

/**
 * Compute new positions for `items` so they are all aligned along
 * the given axis/edge. The alignment reference is the bounding
 * box of the selection — left/top/right/bottom/center-x/center-y
 * of whatever is currently selected — not the canvas.
 *
 * Returns a list of {itemId, from, to} deltas that also feed the
 * undo history's "move" entry unchanged.
 */
export function alignItems(
  items: CanvasItem[],
  axis: Axis,
  edge: AlignEdge,
): { itemId: string; from: { x: number; y: number }; to: { x: number; y: number } }[] {
  if (items.length < 2) return []
  const minX = Math.min(...items.map((i) => i.x))
  const maxX = Math.max(...items.map((i) => i.x + i.w))
  const minY = Math.min(...items.map((i) => i.y))
  const maxY = Math.max(...items.map((i) => i.y + i.h))
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  return items
    .map((item) => {
      const from = { x: item.x, y: item.y }
      let nx = item.x
      let ny = item.y
      if (axis === 'x') {
        if (edge === 'start') nx = minX
        else if (edge === 'end') nx = maxX - item.w
        else nx = cx - item.w / 2
      } else {
        if (edge === 'start') ny = minY
        else if (edge === 'end') ny = maxY - item.h
        else ny = cy - item.h / 2
      }
      return { itemId: item.id, from, to: { x: nx, y: ny } }
    })
    .filter((m) => m.from.x !== m.to.x || m.from.y !== m.to.y)
}

/**
 * Even-distribute the selection along one axis. Keeps the endpoints
 * where they are and spaces the middle items so that all inter-tile
 * gaps are equal. Needs at least three items to do anything useful.
 */
export function distributeItems(
  items: CanvasItem[],
  axis: Axis,
): { itemId: string; from: { x: number; y: number }; to: { x: number; y: number } }[] {
  if (items.length < 3) return []
  // Sort by the axis' start, hold the extremes fixed, interpolate.
  const sorted = [...items].sort((a, b) => (axis === 'x' ? a.x - b.x : a.y - b.y))
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const totalRun =
    axis === 'x'
      ? last.x + last.w - first.x
      : last.y + last.h - first.y
  const sumSizes = sorted.reduce((acc, i) => acc + (axis === 'x' ? i.w : i.h), 0)
  const gap = (totalRun - sumSizes) / (sorted.length - 1)
  let cursor = axis === 'x' ? first.x + first.w : first.y + first.h
  const moves: ReturnType<typeof distributeItems> = []
  for (let i = 1; i < sorted.length - 1; i++) {
    const item = sorted[i]
    const from = { x: item.x, y: item.y }
    const nx = axis === 'x' ? cursor + gap : item.x
    const ny = axis === 'y' ? cursor + gap : item.y
    if (nx !== item.x || ny !== item.y) {
      moves.push({ itemId: item.id, from, to: { x: nx, y: ny } })
    }
    cursor = (axis === 'x' ? nx + item.w : ny + item.h)
  }
  return moves
}

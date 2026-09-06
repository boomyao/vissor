import type { AspectRatio } from './api.js'
import type { CanvasItem } from './types.js'

export const MAX_IMAGE_COUNT = 12
export const DEFAULT_IMAGE_COUNT = 1

export interface GenerationPlan {
  images: string[]
  aspectRatio?: AspectRatio
}

export function imageSlotPosition(
  items: CanvasItem[],
  turnId: string,
  index: number,
): { x: number; y: number } {
  const step = 512 + 24
  const sibling = items.find((item) => item.turnId === turnId)
  if (sibling) {
    const firstIndex = sibling.variantIndex ?? 0
    return {
      x: sibling.x + (index % 4 - firstIndex % 4) * step,
      y: sibling.y + (Math.floor(index / 4) - Math.floor(firstIndex / 4)) * step,
    }
  }
  const bottom = items.reduce((max, item) => Math.max(max, item.y + item.h), 0)
  return {
    x: (index % 4) * step,
    y: bottom + (items.length ? 48 : 0) + Math.floor(index / 4) * step,
  }
}

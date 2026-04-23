import { useEffect, useRef } from 'react'
import type { CanvasItem } from '@vissor/shared'
import { useStore } from '../store/store.js'
import { api } from './api.js'

/**
 * Very small undo/redo stack. Tracks three kinds of user action:
 *   - move:    tile(s) repositioned (including group drag)
 *   - add:     tile(s) appended (from drag-drop upload, duplicate)
 *   - delete:  tile(s) removed
 *
 * Codex-produced tiles are explicitly NOT in this stack — re-running
 * a turn is a server action, not a reversible edit. The stack lives
 * per session (in memory) and is cleared on project switch.
 */

export type HistoryEntry =
  | { kind: 'move'; moves: { itemId: string; from: XY; to: XY }[] }
  | { kind: 'add'; items: CanvasItem[] }
  | { kind: 'delete'; items: CanvasItem[] }

interface XY {
  x: number
  y: number
}

const undoStack: HistoryEntry[] = []
const redoStack: HistoryEntry[] = []

export function pushHistory(entry: HistoryEntry): void {
  undoStack.push(entry)
  // Any fresh action invalidates the redo stack.
  redoStack.length = 0
}

export function resetHistory(): void {
  undoStack.length = 0
  redoStack.length = 0
}

async function applyMoves(moves: { itemId: string; to: XY }[]): Promise<void> {
  const projectId = useStore.getState().project?.id
  if (!projectId) return
  for (const m of moves) {
    useStore.getState().patchItem(m.itemId, { x: m.to.x, y: m.to.y })
    await api.patchItem(projectId, m.itemId, m.to).catch(() => undefined)
  }
}

async function restoreItems(items: CanvasItem[]): Promise<void> {
  const projectId = useStore.getState().project?.id
  if (!projectId) return
  for (const item of items) {
    if (item.kind !== 'image') continue
    // Re-place via the public "place asset" endpoint. We lose the
    // original id (a fresh one is minted server-side) but the asset
    // and position survive, which is what the user actually cares
    // about. The server publishes item.added via SSE, so local
    // state rehydrates automatically.
    await api
      .placeAsset(projectId, item.assetId, item.x, item.y, {
        w: item.w,
        h: item.h,
      })
      .catch(() => undefined)
  }
}

async function removeItems(items: CanvasItem[]): Promise<void> {
  const projectId = useStore.getState().project?.id
  if (!projectId) return
  for (const item of items) {
    useStore.setState((s) => ({
      items: s.items.filter((i) => i.id !== item.id),
    }))
    await api.deleteItem(projectId, item.id).catch(() => undefined)
  }
}

async function invertEntry(entry: HistoryEntry): Promise<HistoryEntry> {
  switch (entry.kind) {
    case 'move':
      await applyMoves(entry.moves.map((m) => ({ itemId: m.itemId, to: m.from })))
      return { kind: 'move', moves: entry.moves.map((m) => ({ itemId: m.itemId, from: m.to, to: m.from })) }
    case 'add':
      await removeItems(entry.items)
      return { kind: 'delete', items: entry.items }
    case 'delete':
      await restoreItems(entry.items)
      return { kind: 'add', items: entry.items }
  }
}

export async function undo(): Promise<boolean> {
  const entry = undoStack.pop()
  if (!entry) return false
  const inverse = await invertEntry(entry)
  redoStack.push(inverse)
  return true
}

export async function redo(): Promise<boolean> {
  const entry = redoStack.pop()
  if (!entry) return false
  const inverse = await invertEntry(entry)
  undoStack.push(inverse)
  return true
}

/**
 * Hook that wires Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z to the stack. Also
 * listens for project changes and clears the stack so an undo in
 * project B doesn't accidentally touch project A.
 */
export function useHistoryKeybindings(): void {
  const projectId = useStore((s) => s.project?.id ?? null)
  const lastProjectId = useRef<string | null>(null)

  useEffect(() => {
    if (lastProjectId.current !== projectId) {
      resetHistory()
      lastProjectId.current = projectId
    }
  }, [projectId])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const target = e.target as HTMLElement | null
      // Don't steal Cmd+Z from input fields — the user is editing.
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        void undo()
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault()
        void redo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

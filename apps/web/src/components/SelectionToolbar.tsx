import { useCallback, useState } from 'react'
import { useStore } from '../store/store.js'
import { api } from '../lib/api.js'
import { pushHistory } from '../lib/history.js'
import {
  alignItems,
  distributeItems,
  type AlignEdge,
  type Axis,
} from '../lib/align.js'

/**
 * A small floating toolbar that appears when two or more tiles are
 * selected. Exposes bulk operations that don't make sense for a
 * single tile (where the right-click menu is enough):
 *   - Use as reference (attach every selected image to the command bar)
 *   - Download (N PNGs)
 *   - Delete (with undo)
 *   - Clear selection
 */
export function SelectionToolbar(): JSX.Element | null {
  const selection = useStore((s) => s.selection)
  const items = useStore((s) => s.items)
  const attachedAssetIds = useStore((s) => s.attachedAssetIds)
  const attachAsset = useStore((s) => s.attachAsset)
  const clearSelection = useStore((s) => s.clearSelection)
  const project = useStore((s) => s.project)

  const selectedItems = [...selection]
    .map((id) => items.find((i) => i.id === id))
    .filter((i): i is NonNullable<typeof i> => !!i)
  const selectedImages = selectedItems.filter(
    (i): i is Extract<typeof i, { kind: 'image' }> => i.kind === 'image',
  )
  const attachable = selectedImages.filter(
    (i) => !attachedAssetIds.includes(i.assetId),
  )

  const onDownloadAll = useCallback(() => {
    for (const item of selectedImages) {
      // Trigger each download via a synthetic anchor.
      const a = document.createElement('a')
      a.href = api.fileUrl(item.assetId)
      a.download = `vissor-${item.assetId.slice(0, 8)}.png`
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
    }
  }, [selectedImages])

  const onAttachAll = useCallback(() => {
    for (const item of attachable) attachAsset(item.assetId)
    clearSelection()
  }, [attachable, attachAsset, clearSelection])

  const onDeleteAll = useCallback(async () => {
    if (!project || selectedItems.length === 0) return
    // Push a single history entry so one Cmd-Z restores everything.
    pushHistory({ kind: 'delete', items: selectedItems })
    const ids = new Set(selectedItems.map((i) => i.id))
    useStore.setState((s) => ({
      items: s.items.filter((i) => !ids.has(i.id)),
      selection: new Set(),
    }))
    await Promise.all(
      selectedItems.map((i) =>
        api.deleteItem(project.id, i.id).catch(() => undefined),
      ),
    )
  }, [project, selectedItems])

  const [alignOpen, setAlignOpen] = useState(false)

  const applyMoves = useCallback(
    (
      moves: {
        itemId: string
        from: { x: number; y: number }
        to: { x: number; y: number }
      }[],
    ) => {
      if (!project || moves.length === 0) return
      pushHistory({ kind: 'move', moves })
      const patchItem = useStore.getState().patchItem
      for (const m of moves) {
        patchItem(m.itemId, { x: m.to.x, y: m.to.y })
        void api.patchItem(project.id, m.itemId, m.to).catch(() => undefined)
      }
      setAlignOpen(false)
    },
    [project],
  )

  const onAlign = useCallback(
    (axis: Axis, edge: AlignEdge) => {
      applyMoves(alignItems(selectedItems, axis, edge))
    },
    [applyMoves, selectedItems],
  )
  const onDistribute = useCallback(
    (axis: Axis) => {
      applyMoves(distributeItems(selectedItems, axis))
    },
    [applyMoves, selectedItems],
  )

  if (selection.size < 2) return null

  return (
    <div
      style={{
        position: 'absolute',
        top: 70,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: 6,
        padding: 6,
        background: 'var(--bg-elev)',
        border: '1px solid var(--border)',
        borderRadius: 999,
        boxShadow: 'var(--shadow-lg)',
        zIndex: 4,
      }}
    >
      <span
        style={{
          padding: '4px 10px',
          fontSize: 12,
          color: 'var(--fg-dim)',
          alignSelf: 'center',
        }}
      >
        {selection.size} selected
      </span>
      {attachable.length > 0 && (
        <button
          type="button"
          onClick={onAttachAll}
          style={{ padding: '4px 12px', fontSize: 12, borderRadius: 999 }}
          title="Attach all as references to the next prompt"
        >
          ↯ Use as reference ({attachable.length})
        </button>
      )}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setAlignOpen((v) => !v)}
          style={{ padding: '4px 12px', fontSize: 12, borderRadius: 999 }}
          title="Align / distribute selected"
        >
          ▤ Align
        </button>
        {alignOpen && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: 0,
              background: 'var(--bg-elev)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              boxShadow: 'var(--shadow-lg)',
              padding: 4,
              display: 'grid',
              gridTemplateColumns: 'repeat(3, auto)',
              gap: 2,
              zIndex: 6,
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <AlignButton label="⇤" onClick={() => onAlign('x', 'start')} title="Align left" />
            <AlignButton label="⇔" onClick={() => onAlign('x', 'center')} title="Center horizontally" />
            <AlignButton label="⇥" onClick={() => onAlign('x', 'end')} title="Align right" />
            <AlignButton label="⇞" onClick={() => onAlign('y', 'start')} title="Align top" />
            <AlignButton label="⇕" onClick={() => onAlign('y', 'center')} title="Center vertically" />
            <AlignButton label="⇟" onClick={() => onAlign('y', 'end')} title="Align bottom" />
            <AlignButton
              label="↔"
              onClick={() => onDistribute('x')}
              title="Distribute horizontally"
              disabled={selectedItems.length < 3}
            />
            <span />
            <AlignButton
              label="↕"
              onClick={() => onDistribute('y')}
              title="Distribute vertically"
              disabled={selectedItems.length < 3}
            />
          </div>
        )}
      </div>
      {selectedImages.length > 0 && (
        <button
          type="button"
          onClick={onDownloadAll}
          style={{ padding: '4px 12px', fontSize: 12, borderRadius: 999 }}
          title="Download all selected"
        >
          ↓ Download ({selectedImages.length})
        </button>
      )}
      <button
        type="button"
        onClick={() => void onDeleteAll()}
        style={{
          padding: '4px 12px',
          fontSize: 12,
          borderRadius: 999,
          color: 'var(--danger)',
        }}
        title="Delete all selected (Cmd-Z to undo)"
      >
        ✕ Delete ({selectedItems.length})
      </button>
      <button
        type="button"
        onClick={clearSelection}
        title="Clear selection (Esc)"
        style={{ padding: '4px 10px', fontSize: 12, borderRadius: 999 }}
      >
        Clear
      </button>
    </div>
  )
}

function AlignButton({
  label,
  onClick,
  title,
  disabled,
}: {
  label: string
  onClick: () => void
  title: string
  disabled?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: 30,
        height: 30,
        fontSize: 14,
        borderRadius: 6,
        padding: 0,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {label}
    </button>
  )
}

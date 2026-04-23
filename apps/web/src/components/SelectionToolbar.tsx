import { useCallback } from 'react'
import { useStore } from '../store/store.js'
import { api } from '../lib/api.js'

/**
 * A small floating toolbar that appears when two or more tiles are
 * selected. Exposes bulk operations that don't make sense for a
 * single tile (where the right-click menu is enough).
 *
 * Currently: batch download + clear selection. More ("group", "lock"
 * …) can land here later.
 */
export function SelectionToolbar(): JSX.Element | null {
  const selection = useStore((s) => s.selection)
  const items = useStore((s) => s.items)
  const clearSelection = useStore((s) => s.clearSelection)

  const selectedImages = [...selection]
    .map((id) => items.find((i) => i.id === id))
    .filter((i): i is NonNullable<typeof i> => !!i && i.kind === 'image')

  const onDownloadAll = useCallback(() => {
    for (const item of selectedImages) {
      if (item.kind !== 'image') continue
      // Trigger each download via a synthetic anchor. Spacing them out
      // slightly avoids some browsers' "multiple downloads" prompt.
      const a = document.createElement('a')
      a.href = api.fileUrl(item.assetId)
      a.download = `vissor-${item.assetId.slice(0, 8)}.png`
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
    }
  }, [selectedImages])

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
      {selectedImages.length > 0 && (
        <button
          type="button"
          onClick={onDownloadAll}
          style={{
            padding: '4px 12px',
            fontSize: 12,
            borderRadius: 999,
          }}
          title="Download all selected"
        >
          ↓ Download ({selectedImages.length})
        </button>
      )}
      <button
        type="button"
        onClick={clearSelection}
        title="Clear selection (Esc)"
        style={{
          padding: '4px 10px',
          fontSize: 12,
          borderRadius: 999,
        }}
      >
        Clear
      </button>
    </div>
  )
}

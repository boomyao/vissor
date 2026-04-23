import { useEffect } from 'react'
import type { CanvasItem } from '@vissor/shared'
import { useStore } from '../store/store.js'
import { api } from '../lib/api.js'
import { pushHistory } from '../lib/history.js'

interface Props {
  item: CanvasItem
  /** Screen-space position at which the menu should open. */
  x: number
  y: number
  onClose: () => void
}

/**
 * Right-click context menu for a canvas tile. Kept intentionally
 * small — duplicate, use as reference, download, delete. Anything
 * more structural (lock / group / frame rename) goes in the drawer.
 *
 * Rendered at the document root as a fixed overlay so the menu never
 * clips against the tile edges.
 */
export function TileMenu({ item, x, y, onClose }: Props): JSX.Element {
  const project = useStore((s) => s.project)
  const attach = useStore((s) => s.attachAsset)
  const attached = useStore((s) => s.attachedAssetIds)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onMouse = (e: MouseEvent) => {
      // Any click outside the menu closes it. The menu itself stops
      // propagation on click so items work.
      if (!(e.target as HTMLElement).closest('[data-tile-menu]')) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onMouse)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onMouse)
    }
  }, [onClose])

  const assetId = item.kind === 'image' ? item.assetId : null

  const onDuplicate = async () => {
    onClose()
    if (!project || item.kind !== 'image') return
    const GAP = 24
    const beforeIds = new Set(useStore.getState().items.map((i) => i.id))
    await api.placeAsset(
      project.id,
      item.assetId,
      item.x + item.w + GAP,
      item.y,
      { w: item.w, h: item.h },
    )
    setTimeout(() => {
      const newItems = useStore
        .getState()
        .items.filter((i) => !beforeIds.has(i.id))
      if (newItems.length) pushHistory({ kind: 'add', items: newItems })
    }, 300)
  }

  const onUseAsReference = () => {
    onClose()
    if (!assetId) return
    if (attached.includes(assetId)) return
    attach(assetId)
  }

  const onGenerateMoreLikeThis = () => {
    onClose()
    if (!assetId) return
    if (!attached.includes(assetId)) attach(assetId)
    // Prefill the composer with a short prompt so the user can send
    // immediately or tweak before sending. Match the phrasing style
    // that codex handles well via the design-agent system prompt.
    window.dispatchEvent(
      new CustomEvent('vissor:prefill-composer', {
        detail: {
          text: 'More variations of this — keep the subject and composition, vary the lighting and palette.',
        },
      }),
    )
  }

  const onDelete = async () => {
    onClose()
    if (!project) return
    pushHistory({ kind: 'delete', items: [item] })
    useStore.setState((s) => ({
      items: s.items.filter((i) => i.id !== item.id),
      selection: new Set(),
    }))
    await api.deleteItem(project.id, item.id).catch(() => undefined)
  }

  const onBringToFront = async () => {
    onClose()
    if (!project) return
    const maxZ = Math.max(
      ...useStore.getState().items.map((i) => i.z),
      item.z,
    )
    const nextZ = maxZ + 1
    useStore.getState().patchItem(item.id, { z: nextZ })
    await api.patchItem(project.id, item.id, { z: nextZ }).catch(() => undefined)
  }

  const onSendToBack = async () => {
    onClose()
    if (!project) return
    const minZ = Math.min(
      ...useStore.getState().items.map((i) => i.z),
      item.z,
    )
    const nextZ = minZ - 1
    useStore.getState().patchItem(item.id, { z: nextZ })
    await api.patchItem(project.id, item.id, { z: nextZ }).catch(() => undefined)
  }

  const downloadName = assetId
    ? `vissor-${assetId.slice(0, 8)}${extFor(item)}`
    : undefined

  return (
    <div
      data-tile-menu
      style={{
        position: 'fixed',
        top: y,
        left: x,
        minWidth: 180,
        background: 'var(--bg-elev)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow-lg)',
        padding: 4,
        zIndex: 100,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <MenuItem label="Duplicate" onClick={onDuplicate} disabled={item.kind !== 'image'} />
      <MenuItem
        label={
          assetId && attached.includes(assetId)
            ? 'Attached as reference'
            : 'Use as reference'
        }
        onClick={onUseAsReference}
        disabled={!assetId || (!!assetId && attached.includes(assetId))}
      />
      <MenuItem
        label="Generate more like this"
        onClick={onGenerateMoreLikeThis}
        disabled={!assetId}
      />
      <MenuItem label="Bring to front" onClick={onBringToFront} />
      <MenuItem label="Send to back" onClick={onSendToBack} />
      {assetId && (
        <a
          href={api.fileUrl(assetId)}
          download={downloadName}
          onClick={onClose}
          style={{
            display: 'block',
            padding: '7px 10px',
            fontSize: 13,
            color: 'var(--fg)',
            textDecoration: 'none',
            borderRadius: 6,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-elev-2)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          Download
        </a>
      )}
      <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
      <MenuItem label="Delete" destructive onClick={onDelete} />
    </div>
  )
}

function MenuItem({
  label,
  onClick,
  disabled,
  destructive,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  destructive?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '7px 10px',
        fontSize: 13,
        color: destructive ? 'var(--danger)' : 'var(--fg)',
        border: 'none',
        background: 'transparent',
        borderRadius: 6,
        cursor: disabled ? 'default' : 'pointer',
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = 'var(--bg-elev-2)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      {label}
    </button>
  )
}

function extFor(item: CanvasItem): string {
  if (item.kind !== 'image') return ''
  // The asset id doesn't carry an extension; we pick a default.
  // The server-side Content-Type on /api/files/:id is authoritative
  // for the browser; this just affects the downloaded filename.
  return '.png'
}

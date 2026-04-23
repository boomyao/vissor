import { useStore } from '../store/store.js'
import { api } from '../lib/api.js'

function extFromMime(mime: string): string {
  switch (mime) {
    case 'image/png': return '.png'
    case 'image/jpeg': return '.jpg'
    case 'image/webp': return '.webp'
    case 'image/gif': return '.gif'
    default: return ''
  }
}

/**
 * Right-side drawer — opens when a tile is double-clicked. Shows a
 * full-resolution preview and meta info. Can be pinned into the
 * "attached" tray for use as a reference in the next turn.
 */
export function ContextDrawer(): JSX.Element | null {
  const assetId = useStore((s) => s.drawerAssetId)
  const asset = useStore((s) => (assetId ? s.assets[assetId] : null))
  const close = useStore((s) => s.openDrawer)
  const attach = useStore((s) => s.attachAsset)
  const attached = useStore((s) => s.attachedAssetIds)

  if (!assetId || !asset) return null

  const isAttached = attached.includes(assetId)

  return (
    <aside
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        bottom: 12,
        width: 360,
        background: 'var(--bg-elev)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 5,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <strong style={{ fontSize: 13 }}>Asset</strong>
        <button
          type="button"
          onClick={() => close(null)}
          style={{ padding: '4px 8px' }}
        >
          ×
        </button>
      </header>

      <div
        style={{
          flex: 1,
          padding: 14,
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div
          style={{
            width: '100%',
            aspectRatio: '1 / 1',
            borderRadius: 12,
            overflow: 'hidden',
            background: 'var(--bg-elev-2)',
            border: '1px solid var(--border)',
          }}
        >
          <img
            src={api.fileUrl(assetId)}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        </div>

        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: '80px 1fr',
            rowGap: 4,
            columnGap: 8,
            fontSize: 12,
            margin: 0,
            color: 'var(--fg-dim)',
          }}
        >
          <dt>ID</dt>
          <dd style={{ margin: 0, color: 'var(--fg)', fontFamily: 'ui-monospace, monospace' }}>
            {asset.id.slice(0, 12)}…
          </dd>
          <dt>Source</dt>
          <dd style={{ margin: 0, color: 'var(--fg)' }}>{asset.source}</dd>
          <dt>Type</dt>
          <dd style={{ margin: 0, color: 'var(--fg)' }}>{asset.mime}</dd>
          <dt>Size</dt>
          <dd style={{ margin: 0, color: 'var(--fg)' }}>{(asset.size / 1024).toFixed(1)} KB</dd>
        </dl>
      </div>

      <footer
        style={{
          display: 'flex',
          gap: 8,
          padding: 12,
          borderTop: '1px solid var(--border)',
        }}
      >
        <button
          type="button"
          onClick={() => attach(assetId)}
          disabled={isAttached}
          style={{
            flex: 1,
            background: isAttached ? undefined : 'var(--accent)',
            borderColor: isAttached ? undefined : 'var(--accent)',
            color: isAttached ? undefined : 'white',
            fontWeight: 600,
          }}
        >
          {isAttached ? 'Attached' : 'Use as reference'}
        </button>
        <a
          href={api.fileUrl(assetId)}
          download={`vissor-${assetId.slice(0, 8)}${extFromMime(asset.mime)}`}
          title="Download"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '6px 12px',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            background: 'transparent',
            color: 'var(--fg)',
            textDecoration: 'none',
            fontSize: 13,
          }}
        >
          ↓
        </a>
      </footer>
    </aside>
  )
}

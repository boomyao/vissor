import { useState } from 'react'
import { useStore } from '../store/store.js'
import { fitCameraTo } from '../lib/camera.js'
import { exportProjectAsZip } from '../lib/exportProject.js'
import { ProjectSwitcher } from './ProjectSwitcher.js'

/**
 * Slim floating top bar — project switcher on the left, zoom readout
 * and sundry controls on the right. Doesn't consume layout space so
 * the canvas stays edge-to-edge.
 */
export function TopBar(): JSX.Element {
  const scale = useStore((s) => s.camera.scale)
  const setCamera = useStore((s) => s.setCamera)
  const items = useStore((s) => s.items)
  const project = useStore((s) => s.project)
  const assets = useStore((s) => s.assets)
  const [exporting, setExporting] = useState(false)

  const onExport = async (): Promise<void> => {
    if (!project || exporting) return
    setExporting(true)
    try {
      await exportProjectAsZip(project, items, assets)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('export failed', err)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        right: 12,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        pointerEvents: 'none',
        zIndex: 3,
      }}
    >
      <div style={{ pointerEvents: 'auto', boxShadow: 'var(--shadow-lg)' }}>
        <ProjectSwitcher />
      </div>

      <div
        style={{
          pointerEvents: 'auto',
          background: 'var(--bg-elev)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '4px 4px 4px 12px',
          fontSize: 12,
          color: 'var(--fg-dim)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <span>{Math.round(scale * 100)}%</span>
        <button
          type="button"
          style={{ padding: '2px 8px' }}
          onClick={() => setCamera(fitCameraTo(items))}
          title="Fit to content"
        >
          Fit
        </button>
        <button
          type="button"
          style={{ padding: '2px 8px' }}
          onClick={() => void onExport()}
          disabled={!project || items.length === 0 || exporting}
          title="Download project as ZIP (images + manifest)"
        >
          {exporting ? 'Exporting…' : 'Export'}
        </button>
        <button
          type="button"
          style={{ padding: '2px 8px' }}
          onClick={() => {
            // Synthesise `?` key to share the same logic as the shortcut.
            window.dispatchEvent(
              new KeyboardEvent('keydown', { key: '?', bubbles: true }),
            )
          }}
          title="Keyboard shortcuts (?)"
        >
          ?
        </button>
      </div>
    </div>
  )
}

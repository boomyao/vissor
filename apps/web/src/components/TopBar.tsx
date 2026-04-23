import { useStore } from '../store/store.js'
import { fitCameraTo } from '../lib/camera.js'
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
      </div>
    </div>
  )
}

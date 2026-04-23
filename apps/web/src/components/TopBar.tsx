import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/store.js'
import { api } from '../lib/api.js'
import { fitCameraTo } from '../lib/camera.js'
import { exportProjectAsZip } from '../lib/exportProject.js'
import { ProjectSwitcher } from './ProjectSwitcher.js'

const CANVAS_BG_PRESETS: { label: string; value: string }[] = [
  { label: 'Default', value: '#f5f5f5' },
  { label: 'White', value: '#ffffff' },
  { label: 'Paper', value: '#f7f3ea' },
  { label: 'Slate', value: '#2a2d31' },
  { label: 'Ink', value: '#14171a' },
]

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
  const [bgOpen, setBgOpen] = useState(false)
  const bgBtnRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!bgOpen) return
    const onClick = (e: MouseEvent): void => {
      if (!bgBtnRef.current) return
      if (!bgBtnRef.current.contains(e.target as Node)) setBgOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [bgOpen])

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

  const onPickBg = async (value: string): Promise<void> => {
    setBgOpen(false)
    if (!project) return
    // Optimistic update — reflect immediately, then persist.
    useStore.setState((s) => ({
      project: s.project ? { ...s.project, canvasBg: value } : s.project,
    }))
    try {
      await api.patchProject(project.id, { canvasBg: value })
    } catch {
      // Best-effort; on failure the bg just reverts on next reload.
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
        <div ref={bgBtnRef} style={{ position: 'relative' }}>
          <button
            type="button"
            style={{
              padding: '2px 8px',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
            onClick={() => setBgOpen((v) => !v)}
            disabled={!project}
            title="Canvas background"
          >
            <span
              aria-hidden
              style={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: project?.canvasBg ?? '#f5f5f5',
                border: '1px solid var(--border)',
              }}
            />
            Bg
          </button>
          {bgOpen && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                right: 0,
                background: 'var(--bg-elev)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                boxShadow: 'var(--shadow-lg)',
                padding: 6,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                zIndex: 20,
                minWidth: 160,
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {CANVAS_BG_PRESETS.map((p) => {
                const active =
                  (project?.canvasBg ?? CANVAS_BG_PRESETS[0].value) === p.value
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => void onPickBg(p.value)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 10px',
                      fontSize: 12,
                      borderRadius: 6,
                      border: 'none',
                      background: active ? 'var(--bg-elev-2)' : 'transparent',
                      color: 'var(--fg)',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: '50%',
                        background: p.value,
                        border: '1px solid var(--border)',
                      }}
                    />
                    <span>{p.label}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
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

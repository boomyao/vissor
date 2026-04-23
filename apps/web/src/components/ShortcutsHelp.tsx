import { useEffect, useState } from 'react'

/**
 * Shortcuts help overlay — activated with `?` (Shift+/).
 *
 * Most of Vissor's power is hidden behind keyboard shortcuts; this
 * modal surfaces them so users don't have to read the source. Kept
 * as a leaf component with no store dependency so it can be dropped
 * into `App` wherever and never needs wiring.
 */
const SHORTCUTS: { group: string; items: { keys: string; label: string }[] }[] = [
  {
    group: 'Canvas',
    items: [
      { keys: 'Space + drag', label: 'Pan' },
      { keys: 'Scroll / pinch', label: 'Zoom' },
      { keys: 'F', label: 'Fit to content' },
      { keys: 'Esc', label: 'Clear selection / close drawer' },
    ],
  },
  {
    group: 'Tiles',
    items: [
      { keys: 'Double-click empty area', label: 'Create text tile' },
      { keys: 'T', label: 'Create text tile at viewport centre' },
      { keys: 'R', label: 'Attach selected image(s) as reference' },
      { keys: '← ↑ → ↓', label: 'Nudge selected (Shift = 10px)' },
      { keys: 'Delete / Backspace', label: 'Delete selected' },
    ],
  },
  {
    group: 'Composer',
    items: [
      { keys: 'Enter', label: 'Send' },
      { keys: 'Shift + Enter', label: 'Newline' },
      { keys: '↑ (empty)', label: 'Recall last prompt' },
    ],
  },
  {
    group: 'History',
    items: [
      { keys: 'Cmd/Ctrl + Z', label: 'Undo' },
      { keys: 'Cmd/Ctrl + Shift + Z', label: 'Redo' },
    ],
  },
  {
    group: 'Help',
    items: [{ keys: '?', label: 'Show this overlay' }],
  },
]

export function ShortcutsHelp(): JSX.Element | null {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName
      const typing =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        (e.target as HTMLElement | null)?.isContentEditable
      // `?` on US layout is Shift+/; keep it simple and match the
      // literal character the browser reports.
      if (!typing && e.key === '?') {
        e.preventDefault()
        setOpen((v) => !v)
      } else if (open && e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520,
          maxHeight: '80vh',
          overflow: 'auto',
          background: 'var(--bg-elev)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          padding: 20,
          color: 'var(--fg)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <strong style={{ fontSize: 14 }}>Keyboard shortcuts</strong>
          <button
            type="button"
            onClick={() => setOpen(false)}
            style={{ padding: '4px 10px', fontSize: 12 }}
          >
            Close
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {SHORTCUTS.map((g) => (
            <section key={g.group}>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: 1.5,
                  textTransform: 'uppercase',
                  color: 'var(--fg-dim)',
                  marginBottom: 6,
                }}
              >
                {g.group}
              </div>
              <dl
                style={{
                  display: 'grid',
                  gridTemplateColumns: '180px 1fr',
                  rowGap: 4,
                  columnGap: 12,
                  margin: 0,
                  fontSize: 13,
                }}
              >
                {g.items.map((it) => (
                  <div key={it.keys} style={{ display: 'contents' }}>
                    <dt
                      style={{
                        margin: 0,
                        fontFamily:
                          'ui-monospace, SFMono-Regular, Menlo, monospace',
                        fontSize: 12,
                        color: 'var(--fg-dim)',
                      }}
                    >
                      {it.keys}
                    </dt>
                    <dd style={{ margin: 0, color: 'var(--fg)' }}>{it.label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

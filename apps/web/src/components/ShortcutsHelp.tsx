import { useEffect, useState } from 'react'
import { useT, type I18nKey } from '../lib/i18n/index.js'

type ShortcutItem = { keysKey: I18nKey | null; keys?: string; labelKey: I18nKey }
type ShortcutGroup = { groupKey: I18nKey; items: ShortcutItem[] }

const SHORTCUTS: ShortcutGroup[] = [
  {
    groupKey: 'shortcuts.group.canvas',
    items: [
      { keysKey: 'shortcuts.keys.space', labelKey: 'shortcuts.canvas.pan' },
      { keysKey: 'shortcuts.keys.scroll', labelKey: 'shortcuts.canvas.zoom' },
      { keysKey: null, keys: 'F', labelKey: 'shortcuts.canvas.fit' },
      { keysKey: null, keys: 'Esc', labelKey: 'shortcuts.canvas.esc' },
    ],
  },
  {
    groupKey: 'shortcuts.group.tiles',
    items: [
      {
        keysKey: 'shortcuts.keys.doubleClick',
        labelKey: 'shortcuts.tiles.doubleClick',
      },
      { keysKey: null, keys: 'T', labelKey: 'shortcuts.tiles.createText' },
      { keysKey: null, keys: 'R', labelKey: 'shortcuts.tiles.attachRef' },
      { keysKey: 'shortcuts.keys.arrows', labelKey: 'shortcuts.tiles.nudge' },
      { keysKey: 'shortcuts.keys.delete', labelKey: 'shortcuts.tiles.delete' },
    ],
  },
  {
    groupKey: 'shortcuts.group.composer',
    items: [
      { keysKey: null, keys: 'Enter', labelKey: 'shortcuts.composer.send' },
      {
        keysKey: null,
        keys: 'Shift + Enter',
        labelKey: 'shortcuts.composer.newline',
      },
      {
        keysKey: 'shortcuts.keys.enterEmpty',
        labelKey: 'shortcuts.composer.recall',
      },
    ],
  },
  {
    groupKey: 'shortcuts.group.history',
    items: [
      { keysKey: 'shortcuts.keys.cmdZ', labelKey: 'shortcuts.history.undo' },
      {
        keysKey: 'shortcuts.keys.cmdShiftZ',
        labelKey: 'shortcuts.history.redo',
      },
    ],
  },
  {
    groupKey: 'shortcuts.group.help',
    items: [{ keysKey: null, keys: '?', labelKey: 'shortcuts.help.overlay' }],
  },
]

export function ShortcutsHelp(): JSX.Element | null {
  const t = useT()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName
      const typing =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        (e.target as HTMLElement | null)?.isContentEditable
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
          <strong style={{ fontSize: 14 }}>{t('shortcuts.title')}</strong>
          <button
            type="button"
            onClick={() => setOpen(false)}
            style={{ padding: '4px 10px', fontSize: 12 }}
          >
            {t('common.close')}
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {SHORTCUTS.map((g) => (
            <section key={g.groupKey}>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: 1.5,
                  textTransform: 'uppercase',
                  color: 'var(--fg-dim)',
                  marginBottom: 6,
                }}
              >
                {t(g.groupKey)}
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
                {g.items.map((it, i) => {
                  const keys = it.keysKey ? t(it.keysKey) : it.keys ?? ''
                  return (
                    <div key={`${keys}-${i}`} style={{ display: 'contents' }}>
                      <dt
                        style={{
                          margin: 0,
                          fontFamily:
                            'ui-monospace, SFMono-Regular, Menlo, monospace',
                          fontSize: 12,
                          color: 'var(--fg-dim)',
                        }}
                      >
                        {keys}
                      </dt>
                      <dd style={{ margin: 0, color: 'var(--fg)' }}>
                        {t(it.labelKey)}
                      </dd>
                    </div>
                  )
                })}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

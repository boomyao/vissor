import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/store.js'
import { api } from '../lib/api.js'
import { fitCameraTo } from '../lib/camera.js'
import { exportProjectAsZip } from '../lib/exportProject.js'
import { setLocale, useLocale, useT, type Locale } from '../lib/i18n/index.js'
import type { I18nKey } from '../lib/i18n/index.js'
import { MiniMap } from './MiniMap.js'
import { ProjectSwitcher } from './ProjectSwitcher.js'

const CANVAS_BG_PRESETS: { labelKey: I18nKey; value: string }[] = [
  { labelKey: 'bg.paper', value: '#f2ede4' },
  { labelKey: 'bg.warm', value: '#eae3d5' },
  { labelKey: 'bg.cool', value: '#f7f3eb' },
  { labelKey: 'bg.card', value: '#fffefb' },
  { labelKey: 'bg.slate', value: '#2a2620' },
]

/**
 * Aperture logomark — simple original glyph for the Vissor wordmark.
 */
function Mark({ size = 18 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 2 L12 12 L20.5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M12 12 L20.5 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M12 12 L3.5 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M12 12 L3.5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  )
}

/**
 * Top bar — aperture mark + Instrument Serif "Vissor" wordmark and
 * project switcher on the left; zoom / Fit / Map / Bg / Export / ?
 * floating pill on the right. Doesn't consume layout space so the
 * canvas stays edge-to-edge.
 */
export function TopBar(): JSX.Element {
  const t = useT()
  const locale = useLocale()
  const scale = useStore((s) => s.camera.scale)
  const setCamera = useStore((s) => s.setCamera)
  const items = useStore((s) => s.items)
  const project = useStore((s) => s.project)
  const assets = useStore((s) => s.assets)
  const [exporting, setExporting] = useState(false)
  const [bgOpen, setBgOpen] = useState(false)
  const [mapOpen, setMapOpen] = useState(false)
  const [langOpen, setLangOpen] = useState(false)
  const bgBtnRef = useRef<HTMLDivElement>(null)
  const mapBtnRef = useRef<HTMLDivElement>(null)
  const langBtnRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!bgOpen) return
    const onClick = (e: MouseEvent): void => {
      if (!bgBtnRef.current) return
      if (!bgBtnRef.current.contains(e.target as Node)) setBgOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [bgOpen])

  useEffect(() => {
    if (!mapOpen) return
    const onClick = (e: MouseEvent): void => {
      if (!mapBtnRef.current) return
      if (!mapBtnRef.current.contains(e.target as Node)) setMapOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [mapOpen])

  useEffect(() => {
    if (!langOpen) return
    const onClick = (e: MouseEvent): void => {
      if (!langBtnRef.current) return
      if (!langBtnRef.current.contains(e.target as Node)) setLangOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [langOpen])

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
        top: 16,
        left: 20,
        right: 20,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        pointerEvents: 'none',
        zIndex: 5,
      }}
    >
      <div
        style={{
          pointerEvents: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'var(--card)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius)',
          padding: '6px 10px 6px 12px',
          boxShadow: 'var(--shadow-sm)',
          color: 'var(--ink)',
        }}
      >
        <Mark />
        <span
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 17,
            lineHeight: 1,
            color: 'var(--ink)',
          }}
        >
          Vissor
        </span>
        <span
          aria-hidden
          style={{
            width: 1,
            height: 14,
            background: 'var(--line)',
            margin: '0 2px',
          }}
        />
        <ProjectSwitcher />
      </div>

      <div
        style={{
          pointerEvents: 'auto',
          background: 'var(--card)',
          border: '1px solid var(--line)',
          borderRadius: 999,
          padding: 4,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--ink-dim)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <span
          style={{
            padding: '0 10px',
            color: 'var(--ink)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {Math.round(scale * 100)}%
        </span>
        <span
          aria-hidden
          style={{ width: 1, height: 14, background: 'var(--line)', margin: '0 2px' }}
        />
        <PillButton
          onClick={() => setCamera(fitCameraTo(items))}
          title={t('common.fitTitle')}
        >
          {t('common.fit')}
        </PillButton>
        <div ref={mapBtnRef} style={{ position: 'relative' }}>
          <PillButton
            onClick={() => setMapOpen((v) => !v)}
            disabled={items.length === 0}
            active={mapOpen}
            title={t('common.mapTitle')}
          >
            {t('common.map')}
          </PillButton>
          {mapOpen && items.length > 0 && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                background: 'var(--card)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: 'var(--shadow-lg)',
                padding: 8,
                zIndex: 20,
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <MiniMap />
            </div>
          )}
        </div>
        <div ref={bgBtnRef} style={{ position: 'relative' }}>
          <PillButton
            onClick={() => setBgOpen((v) => !v)}
            disabled={!project}
            active={bgOpen}
            title={t('common.bgTitle')}
          >
            <span
              aria-hidden
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: project?.canvasBg ?? '#f2ede4',
                border: '1px solid var(--line)',
                marginRight: 6,
                display: 'inline-block',
                verticalAlign: -1,
              }}
            />
            {t('common.bg')}
          </PillButton>
          {bgOpen && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                background: 'var(--card)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-lg)',
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
                      background: active ? 'var(--paper-warm)' : 'transparent',
                      color: 'var(--ink)',
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: '50%',
                        background: p.value,
                        border: '1px solid var(--line)',
                      }}
                    />
                    <span>{t(p.labelKey)}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <span
          aria-hidden
          style={{ width: 1, height: 14, background: 'var(--line)', margin: '0 2px' }}
        />
        <button
          type="button"
          onClick={() => void onExport()}
          disabled={!project || items.length === 0 || exporting}
          title={t('common.exportTitle')}
          style={{
            height: 26,
            padding: '0 12px',
            background: 'var(--ink)',
            border: '1px solid var(--ink)',
            borderRadius: 999,
            color: 'var(--paper)',
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          {exporting ? t('common.exporting') : t('common.export')}
        </button>
        <div ref={langBtnRef} style={{ position: 'relative' }}>
          <PillButton
            onClick={() => setLangOpen((v) => !v)}
            active={langOpen}
            title={t('lang.switch')}
          >
            {locale === 'zh' ? '中' : 'EN'}
          </PillButton>
          {langOpen && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                background: 'var(--card)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: 'var(--shadow-lg)',
                padding: 6,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                zIndex: 20,
                minWidth: 140,
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {(['en', 'zh'] as Locale[]).map((code) => {
                const active = locale === code
                const key: I18nKey = code === 'zh' ? 'lang.zh' : 'lang.en'
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => {
                      setLocale(code)
                      setLangOpen(false)
                    }}
                    style={{
                      padding: '6px 10px',
                      fontSize: 12,
                      borderRadius: 6,
                      border: 'none',
                      background: active ? 'var(--paper-warm)' : 'transparent',
                      color: 'var(--ink)',
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    {t(key)}
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <PillButton
          onClick={() => {
            window.dispatchEvent(
              new KeyboardEvent('keydown', { key: '?', bubbles: true }),
            )
          }}
          title={t('common.shortcutsTitle')}
        >
          ?
        </PillButton>
      </div>
    </div>
  )
}

function PillButton({
  children,
  onClick,
  disabled,
  active,
  title,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  active?: boolean
  title?: string
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        height: 26,
        padding: '0 10px',
        background: active ? 'var(--paper-warm)' : 'transparent',
        border: 'none',
        borderRadius: 999,
        color: active ? 'var(--ink)' : 'var(--ink-dim)',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
      }}
    >
      {children}
    </button>
  )
}

import { useStore } from '../store/store.js'
import { useLocale, useT, type I18nKey } from '../lib/i18n/index.js'

const STARTER_KEYS: I18nKey[] = [
  'hero.starter.logo',
  'hero.starter.lighthouse',
  'hero.starter.running',
  'hero.starter.brutalist',
]

/**
 * Split a template like "A {em:B} C" into three parts around the
 * italic marker. If the marker is absent, the whole string is
 * treated as the pre-italic segment. Keeps translations flexible
 * about where the emphasised word appears in the sentence.
 */
function splitEmphasis(text: string): {
  pre: string
  em: string
  post: string
} {
  const match = text.match(/\{em:([^}]*)\}/)
  if (!match) return { pre: text, em: '', post: '' }
  const idx = match.index ?? 0
  return {
    pre: text.slice(0, idx),
    em: match[1],
    post: text.slice(idx + match[0].length),
  }
}

/**
 * Empty-state hero. Rendered when the current project has no canvas
 * items and no chat history yet. Big serif display + starter chips
 * that prefill the composer.
 */
export function WelcomeHero(): JSX.Element {
  const t = useT()
  const locale = useLocale()
  const project = useStore((s) => s.project)

  const date = new Date().toLocaleDateString(
    locale === 'zh' ? 'zh-CN' : 'en-US',
    { month: 'short', day: 'numeric' },
  )
  const meta = project?.name
    ? t('hero.meta', { project: project.name, date })
    : t('hero.metaUntitled', { date })

  const line2 = splitEmphasis(t('hero.titleLine2'))

  const pickStarter = (text: string): void => {
    window.dispatchEvent(
      new CustomEvent('vissor:prefill-composer', { detail: { text } }),
    )
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        padding: 24,
        paddingBottom: 200,
        zIndex: 2,
      }}
    >
      <div
        style={{
          textAlign: 'center',
          color: 'var(--ink)',
          maxWidth: 800,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <div
          className="vissor-meta"
          style={{ marginBottom: 20, letterSpacing: 3 }}
        >
          {meta}
        </div>
        <h1
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 'clamp(56px, 8vw, 88px)',
            lineHeight: 0.95,
            margin: 0,
            color: 'var(--ink)',
            fontWeight: 400,
            letterSpacing: '-0.02em',
          }}
        >
          {t('hero.titleLine1')}
          <br />
          {line2.pre}
          {line2.em && <em style={{ fontStyle: 'italic' }}>{line2.em}</em>}
          {line2.post}
        </h1>
        <p
          style={{
            marginTop: 28,
            fontSize: 14,
            color: 'var(--ink-dim)',
            maxWidth: 460,
            lineHeight: 1.5,
          }}
        >
          {t('hero.subtitle')}
        </p>

        <div
          style={{
            pointerEvents: 'auto',
            marginTop: 32,
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            justifyContent: 'center',
            maxWidth: 720,
          }}
        >
          {STARTER_KEYS.map((key) => {
            const label = t(key)
            return (
              <button
                key={key}
                type="button"
                onClick={() => pickStarter(label)}
                style={{
                  fontSize: 13,
                  padding: '8px 14px',
                  background: 'var(--card)',
                  border: '1px solid var(--line)',
                  color: 'var(--ink)',
                  borderRadius: 999,
                  cursor: 'pointer',
                }}
              >
                <span style={{ color: 'var(--accent-ink)', marginRight: 6 }}>↯</span>
                {label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

import { useStore } from '../store/store.js'

const STARTER_PROMPTS: string[] = [
  'A logo for a third-wave coffee brand',
  'Editorial illustration of a lighthouse',
  '4 hero frames for a running app',
  'Architectural moodboard — brutalist',
]

/**
 * Empty-state hero. Rendered when the current project has no canvas
 * items and no chat history yet. Big serif display + starter chips
 * that prefill the composer. The command bar stays docked at the
 * bottom and remains interactive (hero is pointer-events: none
 * except for the chips themselves).
 */
export function WelcomeHero(): JSX.Element {
  const project = useStore((s) => s.project)

  const label = project?.name
    ? `${project.name} · ${new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })}`
    : `Untitled project · ${new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })}`

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
          {label}
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
          What do you want
          <br />
          <em style={{ fontStyle: 'italic' }}>to make</em> today?
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
          Describe it below. Each send spawns a cluster of variants on the
          canvas — drag them, iterate on them, arrange them.
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
          {STARTER_PROMPTS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => pickStarter(s)}
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
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

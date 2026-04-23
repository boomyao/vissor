import { useStore } from '../store/store.js'

/**
 * Empty-state hero. Rendered when the current project has no canvas
 * items and no chat history yet. Keeps the surface quiet so the
 * user's attention lands on the command bar. The command bar itself
 * is rendered separately and stays docked at the bottom.
 */
export function WelcomeHero(): JSX.Element {
  const project = useStore((s) => s.project)

  return (
    <div
      aria-hidden
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
          color: 'var(--fg-dim)',
          maxWidth: 520,
        }}
      >
        <div
          style={{
            fontSize: 11,
            letterSpacing: 3,
            textTransform: 'uppercase',
            color: 'var(--fg-dim)',
            marginBottom: 10,
          }}
        >
          {project?.name ?? 'Vissor'}
        </div>
        <h1
          style={{
            fontSize: 32,
            lineHeight: 1.1,
            margin: 0,
            color: 'var(--fg)',
            fontWeight: 600,
            letterSpacing: '-0.02em',
          }}
        >
          What do you want to make today?
        </h1>
        <p style={{ marginTop: 14, fontSize: 14 }}>
          Describe it in the bar below. Attach a reference image to set
          style, or jump right in.
        </p>
      </div>
    </div>
  )
}

import { useStore } from '../store/store.js'

/**
 * Placeholder tiles rendered at the positions where codex will
 * shortly drop real variants. Lives inside the world layer so it
 * pans and zooms with the rest of the canvas; consumed one slot at
 * a time as real items stream in via `item.added`.
 */
export function Skeletons(): JSX.Element | null {
  const pending = useStore((s) => s.pendingSkeletons)
  const slots = Object.values(pending).flat()
  if (slots.length === 0) return null
  return (
    <>
      {slots.map((s) => (
        <SkeletonTile
          key={`${s.turnId}-${s.variantIndex}`}
          x={s.x}
          y={s.y}
          w={s.w}
          h={s.h}
        />
      ))}
    </>
  )
}

function SkeletonTile({
  x,
  y,
  w,
  h,
}: {
  x: number
  y: number
  w: number
  h: number
}): JSX.Element {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        borderRadius: 12,
        overflow: 'hidden',
        border: '1px solid var(--accent)',
        background:
          'linear-gradient(135deg, oklch(0.94 0.04 60), oklch(0.9 0.04 65))',
        boxShadow: '0 0 0 4px oklch(0.7 0.19 50 / 0.1)',
      }}
    >
      <div className="vissor-skeleton-shimmer" />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'flex-end',
          padding: 12,
        }}
      >
        <span
          className="vissor-meta vissor-pulse"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            color: 'var(--accent-ink)',
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--accent)',
              display: 'inline-block',
            }}
          />
          painting
        </span>
      </div>
    </div>
  )
}

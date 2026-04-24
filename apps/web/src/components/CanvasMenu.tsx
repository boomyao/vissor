import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../lib/i18n/index.js'

interface Props {
  /** Screen-space position at which the menu should open. */
  x: number
  y: number
  onPickInsertImage: () => void
  onClose: () => void
}

/**
 * Right-click context menu for empty canvas. Currently one action:
 * pop the native file picker and drop the chosen image at the
 * clicked world point. Portaled to document.body so the menu is not
 * scaled by the camera transform.
 */
export function CanvasMenu({
  x,
  y,
  onPickInsertImage,
  onClose,
}: Props): JSX.Element {
  const t = useT()

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    const onMouse = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement).closest('[data-canvas-menu]')) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onMouse)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onMouse)
    }
  }, [onClose])

  return createPortal(
    <div
      data-canvas-menu
      style={{
        position: 'fixed',
        top: y,
        left: x,
        minWidth: 180,
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow-lg)',
        padding: 4,
        zIndex: 100,
        fontFamily: 'var(--font-sans)',
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={onPickInsertImage}
        style={{
          display: 'block',
          width: '100%',
          textAlign: 'left',
          padding: '7px 10px',
          fontSize: 13,
          color: 'var(--ink)',
          border: 'none',
          background: 'transparent',
          borderRadius: 6,
          cursor: 'pointer',
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = 'var(--paper-warm)')
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.background = 'transparent')
        }
      >
        {t('canvas.insertImage')}
      </button>
    </div>,
    document.body,
  )
}

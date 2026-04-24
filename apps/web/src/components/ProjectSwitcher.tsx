import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store/store.js'
import {
  createAndSwitch,
  deleteCurrent,
  duplicateCurrent,
  renameCurrent,
  switchProject,
} from '../lib/projectOps.js'
import { translate, useT } from '../lib/i18n/index.js'
import { getLocale } from '../lib/i18n/index.js'

/**
 * Top-bar button that expands into a dropdown listing all projects
 * and exposing New / Rename / Delete actions. Keeping the rename
 * flow as a prompt() for now — the shell stays minimal.
 */
export function ProjectSwitcher(): JSX.Element {
  const t = useT()
  const current = useStore((s) => s.project)
  const projects = useStore((s) => s.projects)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!rootRef.current) return
      if (!rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const onSwitch = useCallback(async (id: string) => {
    setOpen(false)
    if (id === current?.id) return
    try {
      await switchProject(id)
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(translate(getLocale(), 'project.switchFailed', { error: String(err) }))
    }
  }, [current?.id])

  const onNew = useCallback(async () => {
    setOpen(false)
    try {
      await createAndSwitch()
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(translate(getLocale(), 'project.createFailed', { error: String(err) }))
    }
  }, [])

  const onRename = useCallback(async () => {
    setOpen(false)
    if (!current) return
    // eslint-disable-next-line no-alert
    const next = prompt(translate(getLocale(), 'project.renamePrompt'), current.name)?.trim()
    if (!next || next === current.name) return
    await renameCurrent(next)
  }, [current])

  const onDuplicate = useCallback(async () => {
    setOpen(false)
    if (!current) return
    try {
      await duplicateCurrent()
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(translate(getLocale(), 'project.duplicateFailed', { error: String(err) }))
    }
  }, [current])

  const onDelete = useCallback(async () => {
    setOpen(false)
    if (!current) return
    // eslint-disable-next-line no-alert
    if (!confirm(translate(getLocale(), 'project.deleteConfirm', { name: current.name }))) return
    await deleteCurrent()
  }, [current])

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '2px 4px',
          borderRadius: 4,
          background: 'transparent',
          border: 'none',
          color: 'var(--ink)',
          fontSize: 13,
          fontWeight: 500,
          maxWidth: 280,
          cursor: 'pointer',
        }}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {current?.name ?? t('project.untitled')}
        </span>
        <span style={{ color: 'var(--ink-dim)', fontSize: 10 }}>▾</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: 0,
            width: 280,
            background: 'var(--card)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-lg)',
            padding: 6,
            zIndex: 20,
            fontFamily: 'var(--font-sans)',
          }}
        >
          <div
            style={{
              maxHeight: 280,
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
            }}
          >
            {projects.map((p) => (
              <ProjectRow
                key={p.id}
                active={p.id === current?.id}
                name={p.name}
                onClick={() => onSwitch(p.id)}
              />
            ))}
          </div>
          <div
            style={{
              borderTop: '1px solid var(--line-soft)',
              marginTop: 6,
              paddingTop: 6,
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
            }}
          >
            <MenuItem onSelect={onNew} label={t('project.new')} />
            <MenuItem
              onSelect={onDuplicate}
              label={t('project.duplicate')}
              disabled={!current}
            />
            <MenuItem
              onSelect={onRename}
              label={t('project.rename')}
              disabled={!current}
            />
            <MenuItem
              onSelect={onDelete}
              label={t('project.delete')}
              disabled={!current}
              destructive
            />
          </div>
        </div>
      )}
    </div>
  )
}

function ProjectRow({
  active,
  name,
  onClick,
}: {
  active: boolean
  name: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '8px 10px',
        borderRadius: 6,
        border: 'none',
        background: active ? 'var(--paper-warm)' : 'transparent',
        color: 'var(--ink)',
        fontSize: 13,
        fontWeight: active ? 500 : 400,
        textAlign: 'left',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        if (!active)
          e.currentTarget.style.background = 'var(--paper-cool)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = active
          ? 'var(--paper-warm)'
          : 'transparent'
      }}
    >
      <span
        aria-hidden
        style={{
          flex: '0 0 auto',
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: active ? 'var(--accent)' : 'transparent',
        }}
      />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </span>
    </button>
  )
}

function MenuItem({
  onSelect,
  label,
  disabled,
  destructive,
}: {
  onSelect: () => void
  label: string
  disabled?: boolean
  destructive?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '8px 10px',
        borderRadius: 6,
        border: 'none',
        background: 'transparent',
        color: destructive ? 'var(--danger)' : 'var(--ink)',
        fontSize: 13,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
      }}
      onMouseEnter={(e) => {
        if (!disabled)
          e.currentTarget.style.background = 'var(--paper-cool)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      {label}
    </button>
  )
}

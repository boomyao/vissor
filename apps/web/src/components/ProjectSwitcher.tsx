import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store/store.js'
import {
  createAndSwitch,
  deleteCurrent,
  duplicateCurrent,
  renameCurrent,
  switchProject,
} from '../lib/projectOps.js'

/**
 * Top-bar button that expands into a dropdown listing all projects
 * and exposing New / Rename / Delete actions. Keeping the rename
 * flow as a prompt() for now — the shell stays minimal.
 */
export function ProjectSwitcher(): JSX.Element {
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
      alert(`Failed to open project: ${err}`)
    }
  }, [current?.id])

  const onNew = useCallback(async () => {
    setOpen(false)
    try {
      await createAndSwitch()
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(`Failed to create project: ${err}`)
    }
  }, [])

  const onRename = useCallback(async () => {
    setOpen(false)
    if (!current) return
    // eslint-disable-next-line no-alert
    const next = prompt('Project name', current.name)?.trim()
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
      alert(`Failed to duplicate project: ${err}`)
    }
  }, [current])

  const onDelete = useCallback(async () => {
    setOpen(false)
    if (!current) return
    // eslint-disable-next-line no-alert
    if (!confirm(`Delete "${current.name}"? This cannot be undone.`)) return
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
          gap: 8,
          padding: '6px 10px 6px 12px',
          borderRadius: 'var(--radius)',
          background: 'var(--bg-elev)',
          border: '1px solid var(--border)',
          fontSize: 13,
          maxWidth: 280,
        }}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {current?.name ?? 'Vissor'}
        </span>
        <span style={{ color: 'var(--fg-dim)', fontSize: 10 }}>▾</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            minWidth: 260,
            maxWidth: 340,
            background: 'var(--bg-elev)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-lg)',
            padding: 6,
            zIndex: 20,
          }}
        >
          <div
            style={{
              maxHeight: 280,
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              padding: 2,
            }}
          >
            {projects.map((p) => {
              const active = p.id === current?.id
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onSwitch(p.id)}
                  style={{
                    textAlign: 'left',
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: 'none',
                    background: active ? 'var(--bg-elev-2)' : 'transparent',
                    color: 'var(--fg)',
                    fontSize: 13,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ marginRight: 6, color: 'var(--fg-dim)' }}>
                    {active ? '●' : ' '}
                  </span>
                  {p.name}
                </button>
              )
            })}
          </div>
          <div
            style={{
              borderTop: '1px solid var(--border)',
              marginTop: 6,
              paddingTop: 6,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <MenuItem onSelect={onNew} label="+ New project" />
            <MenuItem
              onSelect={onDuplicate}
              label="Duplicate current"
              disabled={!current}
            />
            <MenuItem onSelect={onRename} label="Rename current…" disabled={!current} />
            <MenuItem
              onSelect={onDelete}
              label="Delete current…"
              disabled={!current}
              destructive
            />
          </div>
        </div>
      )}
    </div>
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
        textAlign: 'left',
        padding: '8px 10px',
        borderRadius: 6,
        border: 'none',
        background: 'transparent',
        color: destructive ? 'var(--danger)' : 'var(--fg)',
        fontSize: 13,
      }}
    >
      {label}
    </button>
  )
}

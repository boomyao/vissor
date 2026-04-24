import { useEffect, useRef, useState } from 'react'
import type { AuthUserPublic } from '@vissor/shared'
import { useProjectStream } from './lib/useProjectStream.js'
import { useStore } from './store/store.js'
import { bootInitialProject } from './lib/projectOps.js'
import { api } from './lib/api.js'
import { fitCameraTo } from './lib/camera.js'
import { useHistoryKeybindings } from './lib/history.js'
import { useT } from './lib/i18n/index.js'
import { Canvas } from './components/Canvas.js'
import { CommandBar } from './components/CommandBar.js'
import { ContextDrawer } from './components/ContextDrawer.js'
import { LoginScreen } from './components/LoginScreen.js'
import { SelectionToolbar } from './components/SelectionToolbar.js'
import { ShortcutsHelp } from './components/ShortcutsHelp.js'
import { TopBar } from './components/TopBar.js'
import { ChatFeed } from './components/ChatFeed.js'
import { WelcomeHero } from './components/WelcomeHero.js'

type AuthState =
  | { kind: 'probing' }
  | { kind: 'guest' }
  | { kind: 'signed-in'; user: AuthUserPublic }

export function App(): JSX.Element {
  const t = useT()
  const [auth, setAuth] = useState<AuthState>({ kind: 'probing' })

  // Probe /me once on boot, and re-probe whenever something (usually
  // a 401 bubbling out of api.json) fires `vissor:auth-expired`.
  useEffect(() => {
    let cancelled = false
    const probe = async (): Promise<void> => {
      try {
        const { user } = await api.me()
        if (cancelled) return
        setAuth(user ? { kind: 'signed-in', user } : { kind: 'guest' })
      } catch {
        if (!cancelled) setAuth({ kind: 'guest' })
      }
    }
    void probe()
    const onExpired = (): void => {
      void probe()
    }
    window.addEventListener('vissor:auth-expired', onExpired)
    return () => {
      cancelled = true
      window.removeEventListener('vissor:auth-expired', onExpired)
    }
  }, [])

  if (auth.kind === 'probing') {
    return <FullscreenCenter text={t('common.loading')} />
  }
  if (auth.kind === 'guest') {
    return (
      <LoginScreen
        onSignedIn={(user) => setAuth({ kind: 'signed-in', user })}
      />
    )
  }
  return <Workspace user={auth.user} onSignedOut={() => setAuth({ kind: 'guest' })} />
}

interface WorkspaceProps {
  user: AuthUserPublic
  onSignedOut: () => void
}

function Workspace({ user, onSignedOut }: WorkspaceProps): JSX.Element {
  const t = useT()
  const project = useStore((s) => s.project)
  const items = useStore((s) => s.items)
  const chatCount = useStore((s) => s.chat.length)
  const setCamera = useStore((s) => s.setCamera)
  const reset = useStore((s) => s.reset)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  // Re-fit the camera whenever the active project changes, and also
  // once when the first item lands on an otherwise-empty board so the
  // user isn't looking at whitespace while codex renders.
  const lastFitProjectId = useRef<string | null>(null)
  useEffect(() => {
    if (!project) return
    if (project.id !== lastFitProjectId.current) {
      lastFitProjectId.current = project.id
      setCamera(fitCameraTo(items))
    } else if (items.length === 1) {
      // Auto-fit the first item that appears on a fresh board.
      setCamera(fitCameraTo(items))
    }
  }, [project, items, setCamera])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        setLoading(true)
        await bootInitialProject()
      } catch (e) {
        if (!cancelled) setErr(String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useProjectStream(project?.id ?? null)
  useHistoryKeybindings()

  if (loading) return <FullscreenCenter text={t('common.loading')} />
  if (err) return <FullscreenCenter text={t('common.loadFailed', { error: err })} />

  const isEmpty = items.length === 0 && chatCount === 0

  const onSignOut = async (): Promise<void> => {
    await api.logout().catch(() => undefined)
    reset()
    onSignedOut()
  }

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <Canvas />
      <TopBar user={user} onSignOut={onSignOut} />
      <SelectionToolbar />
      {isEmpty ? <WelcomeHero /> : <ChatFeed />}
      <ContextDrawer />
      <CommandBar />
      <ShortcutsHelp />
    </div>
  )
}

function FullscreenCenter({ text }: { text: string }): JSX.Element {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--fg-dim)',
        fontSize: 14,
      }}
    >
      {text}
    </div>
  )
}

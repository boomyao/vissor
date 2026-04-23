import { useEffect, useRef, useState } from 'react'
import { useProjectStream } from './lib/useProjectStream.js'
import { useStore } from './store/store.js'
import { bootInitialProject } from './lib/projectOps.js'
import { fitCameraTo } from './lib/camera.js'
import { useHistoryKeybindings } from './lib/history.js'
import { Canvas } from './components/Canvas.js'
import { CommandBar } from './components/CommandBar.js'
import { ContextDrawer } from './components/ContextDrawer.js'
import { MiniMap } from './components/MiniMap.js'
import { SelectionToolbar } from './components/SelectionToolbar.js'
import { TopBar } from './components/TopBar.js'
import { ChatFeed } from './components/ChatFeed.js'
import { WelcomeHero } from './components/WelcomeHero.js'

export function App(): JSX.Element {
  const project = useStore((s) => s.project)
  const items = useStore((s) => s.items)
  const chatCount = useStore((s) => s.chat.length)
  const setCamera = useStore((s) => s.setCamera)
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

  if (loading) return <FullscreenCenter text="Loading workspace…" />
  if (err) return <FullscreenCenter text={`Could not load: ${err}`} />

  const isEmpty = items.length === 0 && chatCount === 0

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <Canvas />
      <TopBar />
      <SelectionToolbar />
      {isEmpty ? <WelcomeHero /> : <ChatFeed />}
      <MiniMap />
      <ContextDrawer />
      <CommandBar />
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

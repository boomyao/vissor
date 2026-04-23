import { useEffect, useRef, useState } from 'react'
import type { AspectRatio, StylePreset } from '@vissor/shared'
import { useStore } from '../store/store.js'
import { api } from '../lib/api.js'

const COLLAPSED_KEY = 'vissor:chatCollapsed'

/**
 * Floating chat feed in the lower-left. Collapsible so the canvas can
 * stay uncluttered for "production" mode. Collapse state persists.
 */
export function ChatFeed(): JSX.Element | null {
  const chat = useStore((s) => s.chat)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem(COLLAPSED_KEY) === '1',
  )

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  useEffect(() => {
    if (collapsed) return
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [chat, collapsed])

  if (!chat.length) return null

  const agentStreaming = chat.some(
    (m) => m.role === 'agent' && m.status === 'streaming',
  )

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        title="Show conversation"
        style={{
          position: 'absolute',
          bottom: 120,
          left: 12,
          background: 'var(--bg-elev)',
          border: '1px solid var(--border)',
          borderRadius: 999,
          padding: '6px 12px',
          fontSize: 12,
          color: 'var(--fg-dim)',
          boxShadow: 'var(--shadow-lg)',
          zIndex: 3,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {agentStreaming && <span className="vissor-pulse">●</span>}
        Chat · {chat.length}
      </button>
    )
  }

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 120,
        left: 12,
        width: 320,
        maxHeight: 'calc(100vh - 220px)',
        background: 'var(--bg-elev)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: 'var(--shadow-lg)',
        zIndex: 3,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--fg-dim)' }}>
          {agentStreaming && <span className="vissor-pulse">● </span>}
          Conversation
        </span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          title="Hide"
          style={{ padding: '2px 6px', fontSize: 11 }}
        >
          ─
        </button>
      </header>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {chat.map((m) => (
          <div
            key={m.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              padding: 8,
              borderRadius: 'var(--radius)',
              background:
                m.role === 'user' ? 'var(--bg-elev-2)' : 'transparent',
              border: m.role === 'agent' ? '1px solid var(--border)' : 'none',
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: 'var(--fg-dim)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>{m.role === 'user' ? 'You' : 'Agent'}</span>
              {m.role === 'agent' && m.status === 'streaming' && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  · <span className="vissor-pulse">{m.statusLine ?? 'Thinking'}…</span>
                </span>
              )}
              {m.role === 'agent' && m.status === 'failed' && (
                <span style={{ color: 'var(--danger)' }}>· failed</span>
              )}
            </div>
            {m.role === 'user' && m.attachedAssetIds.length > 0 && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {m.attachedAssetIds.map((id) => (
                  <img
                    key={id}
                    src={api.fileUrl(id)}
                    alt=""
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 6,
                      objectFit: 'cover',
                      border: '1px solid var(--border)',
                    }}
                  />
                ))}
              </div>
            )}
            <div
              style={{
                fontSize: 13,
                color: 'var(--fg)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {m.role === 'user'
                ? m.text
                : m.text || (m.status === 'streaming' ? '…' : '')}
            </div>
            {m.role === 'agent' && m.error && (
              <div style={{ fontSize: 12, color: 'var(--danger)' }}>
                {m.error}
              </div>
            )}
            {m.role === 'agent' && m.status === 'failed' && (
              <RetryButton turnId={m.turnId} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function RetryButton({ turnId }: { turnId: string }): JSX.Element | null {
  const project = useStore((s) => s.project)
  const chat = useStore((s) => s.chat)
  const activeTurnId = useStore((s) => s.activeTurnId)

  // The matching user message carries the original turn inputs.
  const userMsg = chat.find(
    (m) => m.role === 'user' && m.turnId === turnId,
  )
  if (!userMsg || userMsg.role !== 'user') return null

  const onClick = async () => {
    if (!project || activeTurnId) return
    const newTurnId = crypto.randomUUID()
    const payload = {
      projectId: project.id,
      turnId: newTurnId,
      text: userMsg.text,
      attachedAssetIds: userMsg.attachedAssetIds,
      variantCount: userMsg.variantCount,
      stylePreset: (userMsg.stylePreset as StylePreset | undefined) ?? undefined,
      aspectRatio: (userMsg.aspectRatio as AspectRatio | undefined) ?? undefined,
    }
    useStore.setState((s) => ({
      chat: [
        ...s.chat,
        {
          id: crypto.randomUUID(),
          role: 'user',
          turnId: newTurnId,
          text: userMsg.text,
          attachedAssetIds: userMsg.attachedAssetIds,
          variantCount: userMsg.variantCount,
          stylePreset: userMsg.stylePreset,
          aspectRatio: userMsg.aspectRatio,
          createdAt: Date.now(),
        },
        {
          id: crypto.randomUUID(),
          role: 'agent',
          turnId: newTurnId,
          status: 'streaming',
          text: '',
          statusLine: 'Thinking',
          producedItemIds: [],
          createdAt: Date.now(),
        },
      ],
      activeTurnId: newTurnId,
    }))
    try {
      await api.sendChat(payload)
    } catch (err) {
      useStore.setState((s) => ({
        chat: s.chat.map((m) =>
          m.role === 'agent' && m.turnId === newTurnId
            ? { ...m, status: 'failed', error: String(err) }
            : m,
        ),
        activeTurnId: null,
      }))
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!!activeTurnId}
      style={{
        alignSelf: 'flex-start',
        marginTop: 4,
        padding: '4px 10px',
        fontSize: 11,
        borderRadius: 999,
        border: '1px solid var(--border)',
      }}
      title="Retry this turn"
    >
      ↻ Retry
    </button>
  )
}

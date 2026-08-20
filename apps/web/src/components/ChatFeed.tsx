import { useEffect, useRef, useState } from 'react'
import type {
  AgentErrorKind,
  AspectRatio,
  ReasoningEffort,
  StylePreset,
} from '@vissor/shared'
import { useStore } from '../store/store.js'
import { api } from '../lib/api.js'
import { fitCameraTo } from '../lib/camera.js'
import { useT, type I18nKey } from '../lib/i18n/index.js'

const COLLAPSED_KEY = 'vissor:chatCollapsed'

/**
 * Floating chat feed in the lower-left. Collapsible so the canvas can
 * stay uncluttered for "production" mode. Collapse state persists.
 */
export function ChatFeed(): JSX.Element | null {
  const t = useT()
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
        title={t('chat.show')}
        style={{
          position: 'absolute',
          bottom: 120,
          right: 12,
          background: 'var(--card)',
          border: '1px solid var(--line)',
          borderRadius: 999,
          padding: '6px 14px',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
          color: 'var(--ink-dim)',
          boxShadow: 'var(--shadow-sm)',
          zIndex: 3,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {agentStreaming && (
          <span
            className="vissor-pulse"
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--accent)',
              display: 'inline-block',
            }}
          />
        )}
        {t('chat.header', { n: chat.length })}
      </button>
    )
  }

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 120,
        right: 12,
        width: 320,
        maxHeight: 'calc(100vh - 220px)',
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-lg)',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: 'var(--shadow-lg)',
        zIndex: 3,
        fontFamily: 'var(--font-sans)',
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: '1px solid var(--line-soft)',
        }}
      >
        <span
          className="vissor-meta"
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          {agentStreaming && (
            <span
              className="vissor-pulse"
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--accent)',
                display: 'inline-block',
              }}
            />
          )}
          {t('chat.header', { n: chat.length })}
        </span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          title={t('chat.hide')}
          style={{
            padding: '2px 6px',
            fontSize: 12,
            color: 'var(--ink-faint)',
            background: 'transparent',
            border: 'none',
          }}
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
              padding: 10,
              borderRadius: 'var(--radius)',
              background:
                m.role === 'user' ? 'var(--paper-warm)' : 'transparent',
              border: m.role === 'agent' ? '1px solid var(--line-soft)' : 'none',
            }}
          >
            <div
              className="vissor-meta"
              style={{
                marginBottom: 2,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 9,
              }}
            >
              <span>{m.role === 'user' ? t('chat.you') : t('chat.agent')}</span>
              {m.role === 'agent' && m.status === 'streaming' && (
                <span
                  className="vissor-pulse"
                  style={{
                    color: 'var(--accent)',
                    fontFamily: 'var(--font-mono)',
                    textTransform: 'none',
                    letterSpacing: 0,
                  }}
                >
                  ● {m.statusLine ?? t('chat.statusThinking')}…
                </span>
              )}
              {m.role === 'agent' && m.status === 'failed' && (
                <span style={{ color: 'var(--danger)' }}>
                  {t('chat.statusFailed')}
                </span>
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
                      border: '1px solid var(--line)',
                    }}
                  />
                ))}
              </div>
            )}
            <div
              style={{
                fontSize: 13,
                color: 'var(--ink)',
                lineHeight: 1.4,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {m.role === 'user'
                ? m.text
                : m.text || (m.status === 'streaming' ? '…' : '')}
            </div>
            {m.role === 'agent' && m.error && (
              <FailureNote error={m.error} kind={m.errorKind} />
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

const FAIL_COPY: Record<string, I18nKey> = {
  quota: 'fail.quota',
  auth: 'fail.auth',
  upstream: 'fail.upstream',
  'no-output': 'fail.noOutput',
  crashed: 'fail.crashed',
  interrupted: 'fail.interrupted',
  internal: 'fail.internal',
  canceled: 'fail.canceled',
}

function FailureNote({
  error,
  kind,
}: {
  error: string
  kind?: AgentErrorKind
}): JSX.Element {
  const t = useT()
  const copyKey = kind ? FAIL_COPY[kind] : undefined
  if (!copyKey) {
    return <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>
  }
  return (
    <div style={{ fontSize: 12, color: 'var(--danger)', lineHeight: 1.45 }}>
      <div>{t(copyKey)}</div>
      <details style={{ marginTop: 3 }}>
        <summary
          style={{
            cursor: 'pointer',
            color: 'var(--ink-faint)',
            fontSize: 11,
            listStyle: 'none',
          }}
        >
          {t('fail.showRaw')}
        </summary>
        <div
          style={{
            marginTop: 3,
            color: 'var(--ink-dim)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            wordBreak: 'break-word',
          }}
        >
          {error}
        </div>
      </details>
    </div>
  )
}

function RetryButton({ turnId }: { turnId: string }): JSX.Element | null {
  const t = useT()
  const project = useStore((s) => s.project)
  const chat = useStore((s) => s.chat)
  const activeTurnId = useStore((s) => s.activeTurnId)
  const startPendingSkeletons = useStore((s) => s.startPendingSkeletons)
  const clearPendingSkeletons = useStore((s) => s.clearPendingSkeletons)

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
      reasoningEffort:
        (userMsg.reasoningEffort as ReasoningEffort | undefined) ?? undefined,
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
          reasoningEffort: userMsg.reasoningEffort,
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
    startPendingSkeletons(
      newTurnId,
      userMsg.variantCount ?? 2,
      (userMsg.aspectRatio as AspectRatio | undefined) ?? 'square',
    )
    const slots = useStore.getState().pendingSkeletons[newTurnId]
    if (slots && slots.length) {
      useStore.getState().setCamera(fitCameraTo(slots))
    }
    try {
      await api.sendChat(payload)
    } catch (err) {
      clearPendingSkeletons(newTurnId)
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
      title={t('chat.retryTitle')}
    >
      {t('chat.retry')}
    </button>
  )
}

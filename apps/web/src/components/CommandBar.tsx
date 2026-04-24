import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReasoningEffort } from '@vissor/shared'
import { useStore } from '../store/store.js'
import { api } from '../lib/api.js'
import { fitCameraTo } from '../lib/camera.js'
import { useT, type I18nKey } from '../lib/i18n/index.js'

/**
 * Bottom floating command bar. Holds the prompt textarea, attached
 * reference tray, upload button, and send button. Mirrors Lovart's
 * centre-bottom "compose dock".
 */
export function CommandBar(): JSX.Element {
  const t = useT()
  const project = useStore((s) => s.project)
  const assets = useStore((s) => s.assets)
  const attached = useStore((s) => s.attachedAssetIds)
  const activeTurnId = useStore((s) => s.activeTurnId)
  const attachAsset = useStore((s) => s.attachAsset)
  const detachAsset = useStore((s) => s.detachAsset)
  const clearAttached = useStore((s) => s.clearAttached)
  const startPendingSkeletons = useStore((s) => s.startPendingSkeletons)
  const clearPendingSkeletons = useStore((s) => s.clearPendingSkeletons)
  const chat = useStore((s) => s.chat)
  const items = useStore((s) => s.items)
  const selection = useStore((s) => s.selection)

  // Selected image tiles (if any). These are offered as "iteration
  // candidates" — on send we implicitly attach them so the agent has
  // the previous artwork as a reference.
  const selectedImageAssetIds = useMemo(() => {
    if (selection.size === 0) return [] as string[]
    const result: string[] = []
    for (const id of selection) {
      const item = items.find((i) => i.id === id)
      if (item?.kind === 'image') result.push(item.assetId)
    }
    return result
  }, [items, selection])

  const [text, setText] = useState('')
  const [busyUpload, setBusyUpload] = useState(false)
  const [variantCount, setVariantCount] = useState<1 | 2 | 4>(1)
  const [reasoningEffort, setReasoningEffort] =
    useState<ReasoningEffort>('low')
  const fileRef = useRef<HTMLInputElement>(null)
  const textAreaRef = useRef<HTMLTextAreaElement>(null)

  // External "prefill + focus" trigger. Anyone (e.g. TileMenu's
  // "Generate more like this") can dispatch
  // `vissor:prefill-composer` with { text } to drop a suggested
  // prompt into the textarea and focus it — saves the user from
  // retyping boilerplate.
  useEffect(() => {
    const onPrefill = (e: Event): void => {
      const detail = (e as CustomEvent<{ text?: string }>).detail
      if (!detail?.text) return
      setText(detail.text)
      // Defer focus one tick so the new value is in the DOM.
      setTimeout(() => {
        const el = textAreaRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      }, 0)
    }
    window.addEventListener('vissor:prefill-composer', onPrefill)
    return () => window.removeEventListener('vissor:prefill-composer', onPrefill)
  }, [])

  const canSend = !!project && !!text.trim() && !activeTurnId

  const onSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault()
      if (!canSend || !project) return
      const turnId = crypto.randomUUID()
      // Include the currently-selected image tiles alongside the
      // explicit attachments, deduped. This is what makes "tap a tile,
      // ask for a variation" work without the user having to hit R.
      const finalAttached = Array.from(
        new Set([...attached, ...selectedImageAssetIds]),
      )
      const payload = {
        projectId: project.id,
        turnId,
        text: text.trim(),
        attachedAssetIds: finalAttached,
        variantCount,
        reasoningEffort,
      }
      setText('')
      clearAttached()
      startPendingSkeletons(turnId, variantCount, undefined)
      // Frame the newly-laid skeletons so the user's eye lands on the
      // painting spots rather than hunting across the board for them.
      const slots = useStore.getState().pendingSkeletons[turnId]
      if (slots && slots.length) {
        useStore.getState().setCamera(fitCameraTo(slots))
      }
      // The server appends the user message and returns it; we optimistically
      // push a local echo so the chat panel paints immediately.
      useStore.setState((s) => ({
        chat: [
          ...s.chat,
          {
            id: crypto.randomUUID(),
            role: 'user',
            turnId,
            text: payload.text,
            attachedAssetIds: payload.attachedAssetIds,
            createdAt: Date.now(),
          },
          {
            id: crypto.randomUUID(),
            role: 'agent',
            turnId,
            status: 'streaming',
            text: '',
            statusLine: 'Thinking',
            producedItemIds: [],
            createdAt: Date.now(),
          },
        ],
        activeTurnId: turnId,
      }))
      try {
        await api.sendChat(payload)
      } catch (err) {
        clearPendingSkeletons(turnId)
        useStore.setState((s) => ({
          chat: s.chat.map((m) =>
            m.role === 'agent' && m.turnId === turnId
              ? { ...m, status: 'failed', error: String(err) }
              : m,
          ),
          activeTurnId: null,
        }))
      }
    },
    [
      attached,
      canSend,
      clearAttached,
      clearPendingSkeletons,
      project,
      reasoningEffort,
      selectedImageAssetIds,
      startPendingSkeletons,
      text,
      variantCount,
    ],
  )

  const onPickFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || !project) return
      setBusyUpload(true)
      try {
        const list = Array.from(files)
        const r = await api.upload(project.id, list)
        for (const a of r.assets) attachAsset(a.id)
      } finally {
        setBusyUpload(false)
      }
    },
    [attachAsset, project],
  )

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void onSubmit()
      return
    }
    // Up-arrow in an empty composer recalls the most recent user
    // prompt from this project's chat history. Skipped if the caret
    // is on a populated line — we don't want to eat in-word nav.
    if (
      e.key === 'ArrowUp' &&
      !e.shiftKey &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.nativeEvent.isComposing &&
      text.length === 0
    ) {
      const lastUser = [...chat]
        .reverse()
        .find((m) => m.role === 'user' && m.text)
      if (lastUser && lastUser.role === 'user') {
        e.preventDefault()
        setText(lastUser.text)
        // Put the caret at the end so Enter sends straight away.
        setTimeout(() => {
          const el = textAreaRef.current
          if (el) el.setSelectionRange(el.value.length, el.value.length)
        }, 0)
      }
    }
  }

  const onCancel = useCallback(async () => {
    if (!project || !activeTurnId) return
    try {
      await api.cancelChat(project.id, activeTurnId)
    } catch {
      // If the HTTP call fails, the turn will still eventually resolve
      // via the normal event stream; swallow so we don't show a scary
      // error for a best-effort abort.
    }
  }, [activeTurnId, project])

  const lastAgent = [...chat].reverse().find((m) => m.role === 'agent')
  const statusPill =
    activeTurnId && lastAgent?.role === 'agent'
      ? lastAgent.statusLine ?? 'Working'
      : null

  return (
    <form
      onSubmit={onSubmit}
      style={{
        position: 'absolute',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(820px, calc(100vw - 64px))',
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-xl)',
        padding: 14,
        boxShadow: 'var(--shadow-lg)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        zIndex: 10,
        fontFamily: 'var(--font-sans)',
      }}
    >
      {statusPill && (
        <div
          style={{
            alignSelf: 'flex-start',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            color: 'var(--accent-ink)',
            background: 'var(--accent-soft)',
            borderRadius: 999,
            padding: '4px 12px',
            border: '1px solid var(--accent)',
          }}
        >
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
          {statusPill}
        </div>
      )}

      {selectedImageAssetIds.length > 0 && (
        <div
          style={{
            alignSelf: 'flex-start',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            color: 'var(--accent-ink)',
            background: 'var(--accent-soft)',
            border: '1px solid var(--accent)',
            borderRadius: 999,
            padding: '3px 12px 3px 4px',
          }}
        >
          {selectedImageAssetIds.slice(0, 3).map((id) => (
            <img
              key={id}
              src={api.fileUrl(id)}
              alt=""
              style={{
                width: 20,
                height: 20,
                borderRadius: 4,
                objectFit: 'cover',
              }}
            />
          ))}
          {selectedImageAssetIds.length > 3 && (
            <span style={{ fontSize: 11 }}>+{selectedImageAssetIds.length - 3}</span>
          )}
          <span>
            {selectedImageAssetIds.length === 1
              ? t('command.iteratingOne')
              : t('command.iteratingMany', { n: selectedImageAssetIds.length })}
          </span>
        </div>
      )}

      {attached.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {attached.map((id) => {
            const a = assets[id]
            return (
              <div
                key={id}
                style={{
                  position: 'relative',
                  width: 48,
                  height: 48,
                  borderRadius: 8,
                  overflow: 'hidden',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-elev-2)',
                }}
              >
                {a && (
                  <img
                    src={api.fileUrl(id)}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                )}
                <button
                  type="button"
                  onClick={() => detachAsset(id)}
                  title="Remove"
                  style={{
                    position: 'absolute',
                    top: -6,
                    right: -6,
                    width: 18,
                    height: 18,
                    padding: 0,
                    borderRadius: 999,
                    background: 'var(--bg)',
                    border: '1px solid var(--border-strong)',
                    fontSize: 10,
                    lineHeight: '16px',
                  }}
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>
      )}

      <textarea
        ref={textAreaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t('command.placeholder')}
        rows={2}
        style={{
          resize: 'none',
          width: '100%',
          background: 'transparent',
          color: 'var(--ink)',
          fontFamily: 'var(--font-sans)',
          fontSize: 15,
          lineHeight: 1.5,
          padding: '4px 2px',
          minHeight: 46,
        }}
      />

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void onPickFiles(e.target.files)
              if (fileRef.current) fileRef.current.value = ''
            }}
          />
          <Chip
            onClick={() => fileRef.current?.click()}
            disabled={busyUpload || !project}
            title={t('command.addImageTitle')}
          >
            {busyUpload ? t('command.uploading') : t('command.addImage')}
          </Chip>
          <VariantCountPicker value={variantCount} onChange={setVariantCount} />
          <ReasoningPicker
            value={reasoningEffort}
            onChange={setReasoningEffort}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!activeTurnId && (
            <span
              className="vissor-meta"
              style={{ letterSpacing: 1, marginRight: 2 }}
            >
              {t('command.send')}
            </span>
          )}
          {activeTurnId ? (
            <button
              type="button"
              onClick={() => void onCancel()}
              style={{
                height: 36,
                padding: '0 22px',
                background: 'var(--card)',
                border: '1px solid var(--ink)',
                borderRadius: 'var(--radius)',
                color: 'var(--ink)',
                fontFamily: 'var(--font-sans)',
                fontSize: 13,
                fontWeight: 500,
              }}
              title={t('command.cancelTurnTitle')}
            >
              {t('command.cancelTurn')}
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              style={{
                height: 36,
                padding: '0 22px',
                background: canSend ? 'var(--ink)' : 'var(--paper-warm)',
                border: `1px solid ${canSend ? 'var(--ink)' : 'var(--line)'}`,
                borderRadius: 'var(--radius)',
                color: canSend ? 'var(--paper)' : 'var(--ink-faint)',
                fontFamily: 'var(--font-sans)',
                fontSize: 13,
                fontWeight: 500,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {t('command.generate')} <span style={{ opacity: 0.6 }}>↗</span>
            </button>
          )}
        </div>
      </div>
    </form>
  )
}

function Chip({
  children,
  onClick,
  disabled,
  active,
  title,
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  active?: boolean
  title?: string
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        height: 28,
        padding: '0 10px',
        fontFamily: 'var(--font-sans)',
        fontSize: 12,
        background: active ? 'var(--paper-warm)' : 'transparent',
        color: active ? 'var(--ink)' : 'var(--ink-dim)',
        border: `1px solid ${active ? 'var(--ink)' : 'var(--line)'}`,
        borderRadius: 999,
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontWeight: active ? 500 : 400,
      }}
    >
      {children}
    </button>
  )
}

function VariantCountPicker({
  value,
  onChange,
}: {
  value: 1 | 2 | 4
  onChange: (n: 1 | 2 | 4) => void
}): JSX.Element {
  const t = useT()
  const options: (1 | 2 | 4)[] = [1, 2, 4]
  const idx = options.indexOf(value)
  const next = (): void => onChange(options[(idx + 1) % options.length])
  return (
    <Chip onClick={next} active title={t('command.countTitle')}>
      <span style={{ color: 'var(--ink-dim)', marginRight: 4 }}>
        {t('command.countLabel')}
      </span>
      <b style={{ fontWeight: 600, color: 'var(--ink)' }}>{value}×</b>
    </Chip>
  )
}


const REASONING_OPTIONS: { value: ReasoningEffort; labelKey: I18nKey }[] = [
  { value: 'low', labelKey: 'command.reasoningLow' },
  { value: 'medium', labelKey: 'command.reasoningMedium' },
  { value: 'high', labelKey: 'command.reasoningHigh' },
  { value: 'xhigh', labelKey: 'command.reasoningXhigh' },
]

function ReasoningPicker({
  value,
  onChange,
}: {
  value: ReasoningEffort
  onChange: (v: ReasoningEffort) => void
}): JSX.Element {
  const t = useT()
  const idx = REASONING_OPTIONS.findIndex((o) => o.value === value)
  const current = REASONING_OPTIONS[idx >= 0 ? idx : 0]
  const next = (): void => {
    const n = REASONING_OPTIONS[(idx + 1) % REASONING_OPTIONS.length]
    onChange(n.value)
  }
  return (
    <Chip onClick={next} active title={t('command.reasoningTitle')}>
      <span style={{ color: 'var(--ink-dim)', marginRight: 4 }}>
        {t('command.reasoningLabel')}
      </span>
      <b style={{ fontWeight: 600, color: 'var(--ink)' }}>
        {t(current.labelKey)}
      </b>
    </Chip>
  )
}


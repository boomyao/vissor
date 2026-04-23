import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AspectRatio, StylePreset } from '@vissor/shared'
import { useStore } from '../store/store.js'
import { api } from '../lib/api.js'

/**
 * Bottom floating command bar. Holds the prompt textarea, attached
 * reference tray, upload button, and send button. Mirrors Lovart's
 * centre-bottom "compose dock".
 */
export function CommandBar(): JSX.Element {
  const project = useStore((s) => s.project)
  const assets = useStore((s) => s.assets)
  const attached = useStore((s) => s.attachedAssetIds)
  const activeTurnId = useStore((s) => s.activeTurnId)
  const attachAsset = useStore((s) => s.attachAsset)
  const detachAsset = useStore((s) => s.detachAsset)
  const clearAttached = useStore((s) => s.clearAttached)
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
  const [variantCount, setVariantCount] = useState<1 | 2 | 4>(2)
  const [stylePreset, setStylePreset] = useState<StylePreset | null>(null)
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('square')
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
        stylePreset: stylePreset ?? undefined,
        aspectRatio,
      }
      setText('')
      clearAttached()
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
      aspectRatio,
      attached,
      canSend,
      clearAttached,
      project,
      selectedImageAssetIds,
      stylePreset,
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
        width: 'min(880px, calc(100vw - 64px))',
        background: 'var(--bg-elev)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: 12,
        boxShadow: 'var(--shadow-lg)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        zIndex: 10,
      }}
    >
      {statusPill && (
        <div
          style={{
            alignSelf: 'flex-start',
            fontSize: 12,
            color: 'var(--fg-dim)',
            background: 'var(--bg-elev-2)',
            borderRadius: 999,
            padding: '4px 10px',
            border: '1px solid var(--border)',
          }}
        >
          ● {statusPill}
        </div>
      )}

      {selectedImageAssetIds.length > 0 && (
        <div
          style={{
            alignSelf: 'flex-start',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            color: 'var(--accent-2)',
            background: 'rgba(13, 153, 255, 0.08)',
            border: '1px solid rgba(13, 153, 255, 0.4)',
            borderRadius: 999,
            padding: '3px 10px 3px 4px',
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
            Iterating on{' '}
            {selectedImageAssetIds.length === 1
              ? '1 tile'
              : `${selectedImageAssetIds.length} tiles`}
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
        placeholder="Describe what you want to create…  (Enter to send, Shift+Enter for newline)"
        rows={2}
        style={{
          resize: 'none',
          width: '100%',
          background: 'transparent',
          color: 'var(--fg)',
          fontSize: 14,
          lineHeight: 1.5,
          padding: 4,
        }}
      />

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busyUpload || !project}
            title="Attach reference image"
          >
            {busyUpload ? 'Uploading…' : '+ Image'}
          </button>
          <VariantCountPicker value={variantCount} onChange={setVariantCount} />
          <StylePicker value={stylePreset} onChange={setStylePreset} />
          <AspectPicker value={aspectRatio} onChange={setAspectRatio} />
        </div>
        {activeTurnId ? (
          <button
            type="button"
            onClick={() => void onCancel()}
            style={{
              background: 'var(--bg-elev)',
              borderColor: 'var(--border-strong)',
              color: 'var(--fg)',
              fontWeight: 600,
              padding: '8px 18px',
            }}
            title="Cancel this turn"
          >
            Cancel
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSend}
            style={{
              background: canSend ? 'var(--accent)' : undefined,
              borderColor: canSend ? 'var(--accent)' : undefined,
              color: canSend ? 'white' : undefined,
              fontWeight: 600,
              padding: '8px 18px',
            }}
          >
            Send
          </button>
        )}
      </div>
    </form>
  )
}

function VariantCountPicker({
  value,
  onChange,
}: {
  value: 1 | 2 | 4
  onChange: (n: 1 | 2 | 4) => void
}): JSX.Element {
  const options: (1 | 2 | 4)[] = [1, 2, 4]
  return (
    <div
      role="group"
      aria-label="Variant count"
      title="Number of variants to generate"
      style={{
        display: 'inline-flex',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
        height: 32,
      }}
    >
      {options.map((n) => {
        const active = n === value
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            style={{
              padding: '0 10px',
              border: 'none',
              borderRadius: 0,
              background: active ? 'var(--bg-elev-2)' : 'transparent',
              color: active ? 'var(--fg)' : 'var(--fg-dim)',
              fontSize: 12,
              fontWeight: active ? 600 : 400,
              minWidth: 30,
            }}
          >
            {n}×
          </button>
        )
      })}
    </div>
  )
}

const STYLE_OPTIONS: { value: StylePreset | null; label: string }[] = [
  { value: null, label: 'Auto style' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'photoreal', label: 'Photoreal' },
  { value: 'illustration', label: 'Illustration' },
  { value: '3d', label: '3D' },
  { value: 'sketch', label: 'Sketch' },
]

const ASPECT_OPTIONS: { value: AspectRatio; label: string; glyph: string }[] = [
  { value: 'square', label: '1:1', glyph: '■' },
  { value: 'portrait', label: '3:4', glyph: '▮' },
  { value: 'landscape', label: '4:3', glyph: '▬' },
  { value: 'wide', label: '16:9', glyph: '▭' },
]

function AspectPicker({
  value,
  onChange,
}: {
  value: AspectRatio
  onChange: (v: AspectRatio) => void
}): JSX.Element {
  return (
    <div
      role="group"
      aria-label="Aspect ratio"
      title="Aspect ratio"
      style={{
        display: 'inline-flex',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
        height: 32,
      }}
    >
      {ASPECT_OPTIONS.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            title={o.label}
            style={{
              padding: '0 10px',
              border: 'none',
              borderRadius: 0,
              background: active ? 'var(--bg-elev-2)' : 'transparent',
              color: active ? 'var(--fg)' : 'var(--fg-dim)',
              fontSize: 12,
              fontWeight: active ? 600 : 400,
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function StylePicker({
  value,
  onChange,
}: {
  value: StylePreset | null
  onChange: (v: StylePreset | null) => void
}): JSX.Element {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange((e.target.value || null) as StylePreset | null)}
      title="Style preset"
      style={{
        height: 32,
        padding: '0 8px',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border)',
        background: 'var(--bg-elev)',
        color: value ? 'var(--fg)' : 'var(--fg-dim)',
        fontSize: 12,
      }}
    >
      {STYLE_OPTIONS.map((o) => (
        <option key={o.label} value={o.value ?? ''}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

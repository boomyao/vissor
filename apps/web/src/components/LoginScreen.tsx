import { useState } from 'react'
import type { AuthUserPublic } from '@vissor/shared'
import { api } from '../lib/api.js'
import { useT } from '../lib/i18n/index.js'

interface Props {
  onSignedIn: (user: AuthUserPublic) => void
}

/**
 * Full-screen login overlay. Shown until /api/auth/me returns a user,
 * or after a 401 bounces the user here. Uses the same warm editorial
 * palette + Instrument Serif display as the welcome hero.
 */
export function LoginScreen({ onSignedIn }: Props): JSX.Element {
  const t = useT()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const { user } = await api.login({
        username: username.trim(),
        password,
      })
      onSignedIn(user)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg === 'invalid_credentials' ? t('auth.invalid') : t('auth.error'))
    } finally {
      setBusy(false)
    }
  }

  const canSubmit = username.trim().length > 0 && password.length > 0 && !busy

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'var(--paper)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        zIndex: 100,
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          width: 'min(380px, 100%)',
          background: 'var(--card)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-lg)',
          padding: 28,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          fontFamily: 'var(--font-sans)',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <h1
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: 44,
              margin: 0,
              color: 'var(--ink)',
              fontWeight: 400,
              letterSpacing: '-0.02em',
              lineHeight: 1,
            }}
          >
            {t('auth.title')}
          </h1>
          <div
            className="vissor-meta"
            style={{ marginTop: 8, letterSpacing: 2 }}
          >
            {t('auth.tagline')}
          </div>
        </div>

        <Field
          label={t('auth.username')}
          value={username}
          onChange={setUsername}
          autoFocus
          autoComplete="username"
        />
        <Field
          label={t('auth.password')}
          value={password}
          onChange={setPassword}
          type="password"
          autoComplete="current-password"
        />

        {error && (
          <div
            role="alert"
            style={{
              fontSize: 12,
              color: 'var(--danger)',
              textAlign: 'center',
            }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            height: 40,
            padding: '0 22px',
            marginTop: 4,
            background: canSubmit ? 'var(--ink)' : 'var(--paper-warm)',
            border: `1px solid ${canSubmit ? 'var(--ink)' : 'var(--line)'}`,
            borderRadius: 'var(--radius)',
            color: canSubmit ? 'var(--paper)' : 'var(--ink-faint)',
            fontSize: 14,
            fontWeight: 500,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
          }}
        >
          {busy ? t('auth.signingIn') : t('auth.signIn')}
        </button>
      </form>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  autoFocus,
  autoComplete,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  type?: 'text' | 'password'
  autoFocus?: boolean
  autoComplete?: string
}): JSX.Element {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span
        className="vissor-meta"
        style={{ fontSize: 9, letterSpacing: 1.5 }}
      >
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        style={{
          height: 36,
          padding: '0 10px',
          background: 'var(--paper-cool)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius)',
          color: 'var(--ink)',
          fontSize: 14,
          fontFamily: 'var(--font-sans)',
        }}
      />
    </label>
  )
}

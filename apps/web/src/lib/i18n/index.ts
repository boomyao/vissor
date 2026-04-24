import { useSyncExternalStore } from 'react'
import { en, type Dict } from './en.js'
import { zh } from './zh.js'

export type Locale = 'en' | 'zh'
export type I18nKey = keyof Dict
export type Vars = Record<string, string | number>

const DICTS: Record<Locale, Dict> = { en, zh }

const STORAGE_KEY = 'vissor:locale'

function detectInitial(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'en' || saved === 'zh') return saved
  } catch {
    // Private-mode browsers may throw on localStorage access.
  }
  // Default to Simplified Chinese for new users regardless of
  // `navigator.language` — flip via the TopBar switcher.
  return 'zh'
}

let current: Locale = detectInitial()
const listeners = new Set<() => void>()

export function getLocale(): Locale {
  return current
}

export function setLocale(next: Locale): void {
  if (next === current) return
  current = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // ignore
  }
  try {
    document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en'
  } catch {
    // ignore
  }
  for (const fn of listeners) fn()
}

// Keep <html lang> in sync with the initial detected locale so the
// browser treats text correctly from the first paint.
if (typeof document !== 'undefined') {
  try {
    document.documentElement.lang = current === 'zh' ? 'zh-CN' : 'en'
  } catch {
    // ignore
  }
}

export function useLocale(): Locale {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    () => current,
    () => current,
  )
}

export function translate(
  locale: Locale,
  key: I18nKey,
  vars?: Vars,
): string {
  const raw: string = DICTS[locale][key] ?? DICTS.en[key] ?? String(key)
  if (!vars) return raw
  return raw.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const v = vars[name]
    return v === undefined ? `{${name}}` : String(v)
  })
}

export function useT(): (key: I18nKey, vars?: Vars) => string {
  const locale = useLocale()
  return (key, vars) => translate(locale, key, vars)
}

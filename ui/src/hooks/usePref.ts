import { useState } from 'react'

/** A per-browser display preference (text size, scroll speed). */
export function usePref<T>(name: string, fallback: T): [T, (v: T) => void] {
  const key = `leadsheet:${name}`
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw === null ? fallback : (JSON.parse(raw) as T)
    } catch {
      return fallback
    }
  })
  const set = (v: T) => {
    setValue(v)
    try {
      localStorage.setItem(key, JSON.stringify(v))
    } catch {
      // storage unavailable; keep it for this page view
    }
  }
  return [value, set]
}

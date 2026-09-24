import type { SheetSummary } from '@/lib/api'

// Sheets opened in this browser, newest first, for "Keep playing".

export interface RecentSheet {
  did: string
  rkey: string
  handle: string
  title: string
  artist: string
  key: string
  capo: number
  openedAt: number
}

const KEY = 'leadsheet:recent'
const MAX = 8

export function recentSheets(): RecentSheet[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export function rememberSheet(s: SheetSummary) {
  const entry: RecentSheet = {
    did: s.did,
    rkey: s.rkey,
    handle: s.author.handle,
    title: s.title,
    artist: s.artist,
    key: s.key,
    capo: s.capo,
    openedAt: Date.now(),
  }
  const rest = recentSheets().filter((r) => !(r.did === s.did && r.rkey === s.rkey))
  try {
    localStorage.setItem(KEY, JSON.stringify([entry, ...rest].slice(0, MAX)))
  } catch {
    // storage unavailable
  }
}

export function forgetSheet(did: string, rkey: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(recentSheets().filter((r) => !(r.did === did && r.rkey === rkey))))
  } catch {
    // storage unavailable
  }
}

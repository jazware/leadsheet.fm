export interface Author {
  did: string
  handle: string
  displayName: string
  avatar: string
}

export interface Stats {
  ratingCount: number
  ratingAvg: number
  favoriteCount: number
  forkCount: number
}

export interface StrongRef {
  uri: string
  cid: string
}

export type Kind = 'chords' | 'tab' | 'ukulele' | 'bass'

export interface SheetSummary {
  uri: string
  did: string
  rkey: string
  cid: string
  title: string
  artist: string
  album: string
  artistSlug: string
  titleSlug: string
  kind: Kind | string
  key: string
  capo: number
  tuning: string
  difficulty: string
  tags: string[]
  forkOf?: StrongRef
  createdAt: string
  updatedAt: string
  author: Author
  stats: Stats
}

export interface Sheet extends SheetSummary {
  content: string
  description: string
}

export interface SongVersion extends SheetSummary {
  version: number
}

export interface ViewerState {
  rating: number
  ratingUris: string[]
  favoriteUris: string[]
}

export interface SheetPage {
  sheet: Sheet
  viewer: ViewerState | null
  forkOf: SheetSummary | null
  forks: SheetSummary[]
  versions: SongVersion[]
}

export interface Song {
  title: string
  artist: string
  artistSlug: string
  titleSlug: string
  versions: SongVersion[]
}

export interface SongResult {
  title: string
  artist: string
  artistSlug: string
  titleSlug: string
  versionCount: number
  kinds: string[]
  top: SheetSummary
  /** A lyric excerpt that matched, hits wrapped in \u0002…\u0003. */
  snippet?: string
}

export interface Artist {
  name: string
  artistSlug: string
  songs: SongResult[]
}

export interface Profile {
  author: Author
  sheets: SheetSummary[]
  favorites: SheetSummary[]
}

export interface SheetInput {
  title: string
  artist: string
  album: string
  kind: string
  content: string
  key: string
  capo: number
  tuning: string
  difficulty: string
  description: string
  tags: string[]
  forkOf?: { uri: string; cid: string }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    let msg = res.statusText
    try {
      msg = (await res.json()).error ?? msg
    } catch {
      // not JSON
    }
    throw new ApiError(msg, res.status)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

const enc = encodeURIComponent

export const api = {
  session: () => request<{ viewer: Author | null }>('GET', '/session'),
  login: (identifier: string, returnTo: string) =>
    request<{ redirect: string }>('POST', '/login', { identifier, returnTo }),
  logout: () => request<void>('POST', '/logout'),

  listSheets: (sort: 'recent' | 'top', limit = 30) =>
    request<{ sheets: SheetSummary[] }>('GET', `/sheets?sort=${sort}&limit=${limit}`),
  sheet: (actor: string, rkey: string) => request<SheetPage>('GET', `/sheets/${enc(actor)}/${enc(rkey)}`),
  createSheet: (input: SheetInput) =>
    request<{ uri: string; did: string; rkey: string }>('POST', '/sheets', input),
  updateSheet: (did: string, rkey: string, input: SheetInput) =>
    request<{ uri: string; did: string; rkey: string }>('PUT', `/sheets/${enc(did)}/${enc(rkey)}`, input),
  deleteSheet: (did: string, rkey: string) => request<void>('DELETE', `/sheets/${enc(did)}/${enc(rkey)}`),
  rate: (did: string, rkey: string, value: number) =>
    request<{ stats: Stats; viewer: ViewerState }>('PUT', `/sheets/${enc(did)}/${enc(rkey)}/rating`, { value }),
  favorite: (did: string, rkey: string, favorite: boolean) =>
    request<{ stats: Stats; viewer: ViewerState }>('PUT', `/sheets/${enc(did)}/${enc(rkey)}/favorite`, { favorite }),

  search: (q: string) => request<{ songs: SongResult[] }>('GET', `/search?q=${enc(q)}`),
  song: (artist: string, title: string) => request<Song>('GET', `/songs/${enc(artist)}/${enc(title)}`),
  artist: (artist: string) => request<Artist>('GET', `/artists/${enc(artist)}`),
  profile: (actor: string) => request<Profile>('GET', `/profiles/${enc(actor)}`),
}

/** Where a sheet lives in the app, by handle when we know it. */
export function sheetPath(s: { did: string; rkey: string; author?: Author }): string {
  return `/sheet/${s.author?.handle || s.did}/${s.rkey}`
}

export function profilePath(a: Author): string {
  return `/u/${a.handle || a.did}`
}

export const KIND_LABEL: Record<string, string> = {
  chords: 'Chords',
  tab: 'Tab',
  ukulele: 'Ukulele',
  bass: 'Bass',
}

import type { SheetInput } from '@/lib/api'
import { chordsOverLyricsToChordPro } from '@/lib/convert'
import { mod12 } from '@/lib/music'
import { tuningsFor } from '@/lib/tunings'

// Importing from Ultimate Guitar: a bookmarklet reads the tab from the UG
// page the user is looking at and opens Leadsheet's editor with it in the
// URL fragment (which never reaches a server). Nothing is published until
// the user reviews the draft and presses Publish.

/** What the bookmarklet sends: UG's own fields, lightly renamed. */
export interface UGImport {
  v: 1
  url: string
  title: string
  artist: string
  /** "Chords", "Tabs", "Ukulele Chords", "Bass Tabs", … */
  type: string
  /** The UG user who transcribed it. */
  author: string
  capo: number
  key: string
  /** Space-separated string names, low to high: "E A D G B E". */
  tuning: string
  difficulty: string
  /** UG markup: [ch]G[/ch] chords, [tab]…[/tab] blocks, [Verse] headers. */
  content: string
}

const IMPORT_PREFIX = '#import='

/**
 * The bookmarklet. It runs on the UG page, so it's self-contained, and
 * `origin` is baked in so it opens whichever Leadsheet it came from.
 */
export function bookmarklet(origin: string): string {
  const src = `(()=>{
let d;
try{const s=window.UGAPP&&UGAPP.store;d=s&&s.page?s.page.data:JSON.parse(document.querySelector('.js-store').dataset.content).store.page.data}catch(e){}
const t=d&&d.tab,v=d&&d.tab_view,c=v&&v.wiki_tab&&v.wiki_tab.content;
if(!c){alert('Leadsheet: open a chords or tab page on Ultimate Guitar, then click this again.');return}
const m=v.meta||{};
const p={v:1,url:location.href,title:t.song_name||'',artist:t.artist_name||'',type:t.type||'',author:t.username||'',capo:m.capo||0,key:m.tonality||'',tuning:(m.tuning&&m.tuning.value)||'',difficulty:m.difficulty||'',content:c};
window.open(${JSON.stringify(origin)}+'/new${IMPORT_PREFIX}'+btoa(unescape(encodeURIComponent(JSON.stringify(p)))),'_blank')
})()`
  return 'javascript:' + encodeURIComponent(src.replace(/\n/g, ''))
}

/** Reads an import from a location hash, or null if there isn't one. */
export function readImport(hash: string): UGImport | null {
  if (!hash.startsWith(IMPORT_PREFIX)) return null
  try {
    const json = decodeURIComponent(escape(atob(decodeURIComponent(hash.slice(IMPORT_PREFIX.length)))))
    const p = JSON.parse(json)
    if (p?.v !== 1 || typeof p.content !== 'string') return null
    return p as UGImport
  } catch {
    return null
  }
}

/** A stable short key for an import's draft, so re-importing resumes it. */
export function importDraftKey(p: UGImport): string {
  let h = 0
  for (const ch of p.url) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0
  return `import:${(h >>> 0).toString(36)}`
}

/** UG markup → ChordPro. */
export function ugToChordPro(content: string): string {
  const plain = content
    .replace(/\r\n?/g, '\n')
    // [tab] blocks pair a chord line with its lyric line (or hold real
    // tablature); without the tags they're chords-over-lyrics text.
    .replace(/\[\/?tab\]/g, '')
    // Chord positions on UG are measured without the tags, so dropping
    // them leaves each chord over the right syllable.
    .replace(/\[ch\]([^[]*?)\[\/ch\]/g, '$1')
  return chordsOverLyricsToChordPro(plain).replace(/\n{3,}/g, '\n\n').trim()
}

/** True for text in UG's [ch]…[/ch] markup. */
export function looksLikeUGMarkup(text: string): boolean {
  return /\[ch\][^[\n]+\[\/ch\]/.test(text)
}

const KINDS: Record<string, string> = {
  chords: 'chords',
  tabs: 'tab',
  tab: 'tab',
  'ukulele chords': 'ukulele',
  ukulele: 'ukulele',
  'bass tabs': 'bass',
  bass: 'bass',
}

const DIFFICULTY: Record<string, string> = {
  novice: 'beginner',
  beginner: 'beginner',
  intermediate: 'intermediate',
  advanced: 'advanced',
  expert: 'advanced',
}

const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** "Eb Ab Db Gb Bb Eb" (or "G C E A", "E A D G") → a Leadsheet tuning id for that instrument, compared by pitch class. */
export function tuningId(value: string, kind = 'chords'): string {
  const pcs = value
    .trim()
    .split(/\s+/)
    .map((n) => {
      const m = /^([A-Ga-g])([#b♯♭]?)/.exec(n)
      if (!m) return null
      const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0
      return mod12(NOTE[m[1].toUpperCase()] + acc)
    })
  if (pcs.some((p) => p === null)) return 'standard'
  const match = tuningsFor(kind).find((t) => t.strings.length === pcs.length && t.strings.every((s, i) => mod12(s) === pcs[i]))
  return match?.id ?? 'standard'
}

/** An import as an editor draft, crediting the transcriber. */
export function importToSheet(p: UGImport): SheetInput {
  const credit = p.author
    ? `Transcribed by ${p.author} on Ultimate Guitar: ${p.url}`
    : `From Ultimate Guitar: ${p.url}`
  return {
    title: p.title.trim(),
    artist: p.artist.trim(),
    album: '',
    kind: KINDS[p.type.trim().toLowerCase()] ?? 'chords',
    content: ugToChordPro(p.content),
    key: p.key.trim(),
    capo: Math.max(0, Math.min(12, Math.round(Number(p.capo) || 0))),
    tuning: p.tuning ? tuningId(p.tuning, KINDS[p.type.trim().toLowerCase()] ?? 'chords') : 'standard',
    difficulty: DIFFICULTY[p.difficulty.trim().toLowerCase()] ?? '',
    description: credit,
    tags: [],
    voicings: [],
  }
}

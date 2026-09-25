// ChordPro files in and out: a sheet's fields as the standard header
// directives, the content as it is. Other songbook apps (OnSong,
// SongbookPro, the ChordPro reference tool) read these.

import type { SheetInput } from '@/lib/api'
import { chordsOverLyricsToChordPro, looksLikeChordsOverLyrics } from '@/lib/convert'
import { getTuning, tuningsFor } from '@/lib/tunings'
import { looksLikeUGMarkup, ugToChordPro } from '@/lib/ultimateGuitar'

/** What the file picker offers. */
export const CHORDPRO_ACCEPT = '.cho,.chordpro,.chopro,.crd,.pro,.txt,text/plain'

const DIRECTIVE_RE = /^\s*\{\s*([a-z_]+)\s*(?:[:\s]\s*(.*?))?\s*\}\s*$/i
const NOTES = '# Notes for players:'
const CREDIT = '# From Leadsheet:'
// Sheet kinds for other instruments, as {meta: instrument …}. (Chords and
// tab are guitar, which needs no saying.)
const INSTRUMENT_KINDS = ['ukulele', 'bass', 'piano']
// Header directives, and {meta: name …} names, that are sheet fields here.
const FIELDS = new Set(['title', 't', 'subtitle', 'st', 'artist', 'album', 'key', 'capo'])
const META_FIELDS = new Set(['title', 'artist', 'album', 'key', 'capo', 'instrument', 'tuning'])

type Exportable = Pick<SheetInput, 'title' | 'artist' | 'album' | 'kind' | 'key' | 'capo' | 'tuning' | 'description' | 'content'>

/** A sheet as a ChordPro file; url credits where it came from. */
export function toChordProFile(s: Exportable, url?: string): string {
  const head: string[] = [`{title: ${s.title}}`]
  if (s.artist) head.push(`{artist: ${s.artist}}`)
  if (s.album) head.push(`{album: ${s.album}}`)
  if (s.key) head.push(`{key: ${s.key}}`)
  if (s.capo) head.push(`{capo: ${s.capo}}`)
  if (INSTRUMENT_KINDS.includes(s.kind)) head.push(`{meta: instrument ${s.kind}}`)
  if (s.kind !== 'piano') {
    const tuning = getTuning(s.tuning, s.kind)
    if (tuning.id !== 'standard') head.push(`{meta: tuning ${tuning.name}}`)
  }
  if (url) head.push(`${CREDIT} ${url}`)
  const notes = s.description.trim()
  if (notes) head.push(NOTES, ...notes.split('\n').map((l) => `#   ${l}`.trimEnd()))
  // The header says these; the sheet's own copies would repeat (or contradict) it.
  const body = s.content
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => !headerField(l))
    .join('\n')
    .trim()
  return `${head.join('\n')}\n\n${body}\n`
}

/** A download name for a sheet: "Artist - Title.cho". */
export function chordProFileName(s: { title: string; artist: string }): string {
  const name = [s.artist, s.title].filter((p) => p.trim()).join(' - ') || 'sheet'
  return `${name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)}.cho`
}

export interface ChordProImport {
  /** Fields the file sets (only those it does). */
  fields: Partial<SheetInput>
  content: string
  /** A songbook file with more than one song: only the first came in. */
  moreSongs: boolean
}

/**
 * A ChordPro (or plain chords-over-lyrics) file as editor fields: the
 * header directives fill in title, artist, album, key, capo, instrument
 * and tuning and leave the content; everything else stays in it.
 */
export function fromChordProFile(text: string): ChordProImport {
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  // Songbook files hold several songs, split by {new_song}.
  const songs = src.split(/^\s*\{\s*(?:new_song|ns)\s*\}\s*$/im).filter((s) => s.trim())
  const song = songs[0] ?? ''
  // {subtitle} is often the artist in older files, when there's no {artist}.
  const hasArtist = song.split('\n').some((l) => /^(artist)$/i.test(directive(l)?.[0] ?? '') || metaName(l) === 'artist')

  const fields: Partial<SheetInput> = {}
  let instrument = ''
  let tuningName = ''
  const notes: string[] = []
  const body: string[] = []
  let inNotes = false
  for (const line of song.split('\n')) {
    if (line.startsWith(NOTES)) {
      inNotes = true
      continue
    }
    if (inNotes && line.startsWith('#')) {
      notes.push(line.replace(/^# {0,3}/, ''))
      continue
    }
    inNotes = false
    if (line.startsWith(CREDIT)) continue

    const d = directive(line)
    let [name, value] = d ?? ['', '']
    if (name === 'meta') {
      const m = /^(\S+)\s+(.*)$/.exec(value)
      if (!m || !META_FIELDS.has(m[1].toLowerCase())) {
        body.push(line)
        continue
      }
      name = m[1].toLowerCase()
      value = m[2].trim()
    } else if (!FIELDS.has(name) || ((name === 'subtitle' || name === 'st') && hasArtist)) {
      body.push(line)
      continue
    }
    switch (name) {
      case 'title':
      case 't':
        fields.title = value
        break
      case 'artist':
      case 'subtitle':
      case 'st':
        fields.artist = value
        break
      case 'album':
        fields.album = value
        break
      case 'key':
        fields.key = value
        break
      case 'capo': {
        const n = Number.parseInt(value, 10)
        if (n >= 0 && n <= 12) fields.capo = n
        break
      }
      case 'instrument':
        instrument = value.toLowerCase()
        break
      case 'tuning':
        tuningName = value.toLowerCase()
        break
    }
  }

  if (INSTRUMENT_KINDS.includes(instrument)) fields.kind = instrument
  if (tuningName) {
    const t = tuningsFor(fields.kind ?? 'chords').find((t) => t.name.toLowerCase() === tuningName || t.id === tuningName)
    if (t) fields.tuning = t.id
  }
  if (notes.length) fields.description = notes.join('\n').trim()

  let content = body.join('\n').trim()
  // A plain text file of chords above lyrics (or UG markup) comes in as ChordPro.
  if (looksLikeUGMarkup(content)) content = ugToChordPro(content)
  else if (looksLikeChordsOverLyrics(content)) content = chordsOverLyricsToChordPro(content).trim()
  return { fields, content, moreSongs: songs.length > 1 }
}

function directive(line: string): [string, string] | null {
  const m = DIRECTIVE_RE.exec(line)
  return m ? [m[1].toLowerCase(), (m[2] ?? '').trim()] : null
}

function metaName(line: string): string {
  const d = directive(line)
  return d?.[0] === 'meta' ? (d[1].split(/\s/)[0] ?? '').toLowerCase() : ''
}

// A header directive that's a sheet field (so it's in the export's header).
function headerField(line: string): boolean {
  const d = directive(line)
  if (!d) return false
  return FIELDS.has(d[0]) || META_FIELDS.has(metaName(line))
}

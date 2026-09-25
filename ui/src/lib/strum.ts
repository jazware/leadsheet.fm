// Strumming patterns, written in a sheet as ChordPro custom directives
// (other apps skip x_ directives):
//
//   {x_strum: D.DU.UDU}          the sheet's pattern
//   {x_strum: chorus D.D.D.D.}   names one (the first named is in use from
//                                the start; later ones wait to be switched to)
//   {x_strum: chorus}            switches to it, from here on
//   {x_strum: once D.......}     one bar of this, then back
//
// One character per slot: D down, U up, x a muted chuck, . a miss (the hand
// keeps moving). ">" accents the next stroke; "|" starts another bar. The
// time signature ({time: 3/4}, default 4/4) and the pattern's length set
// the grid: 8 slots in 4/4 are eighth notes.

import type { Doc, Segment } from '@/lib/chordpro'

export type StrokeKind = 'down' | 'up' | 'chuck' | 'miss'

export interface Stroke {
  kind: StrokeKind
  accent: boolean
}

export interface StrumPattern {
  /** As written, e.g. "D.DU.UDU". */
  source: string
  bars: Stroke[][]
}

/** A pattern coming into use: the sheet's first, a switch, or a one-bar "once". */
export interface StrumChange {
  name: string | null
  pattern: StrumPattern
  once: boolean
}

const PATTERN_RE = /^[DUXx.\-|>]+$/
const KINDS: Record<string, StrokeKind> = { D: 'down', U: 'up', X: 'chuck', x: 'chuck', '.': 'miss', '-': 'miss' }

export function parsePattern(src: string): StrumPattern | null {
  if (!PATTERN_RE.test(src) || !/[DUXx]/.test(src)) return null
  const bars: Stroke[][] = []
  for (const bar of src.split('|')) {
    const strokes: Stroke[] = []
    let accent = false
    for (const ch of bar) {
      if (ch === '>') accent = true
      else {
        strokes.push({ kind: KINDS[ch], accent })
        accent = false
      }
    }
    if (!strokes.length) return null
    bars.push(strokes)
  }
  return { source: src, bars }
}

/**
 * An {x_strum: …} directive's value: a pattern, a name and a pattern, a
 * name alone (a switch), any of them after "once". Null if it's none.
 */
export function parseStrumDirective(value: string): { once: boolean; name: string | null; pattern: StrumPattern | null } | null {
  const tokens = value.trim().split(/\s+/).filter(Boolean)
  const once = tokens[0]?.toLowerCase() === 'once' && tokens.length > 1
  if (once) tokens.shift()
  if (!tokens.length) return null
  if (tokens.length === 1) {
    const pattern = parsePattern(tokens[0])
    return pattern ? { once, name: null, pattern } : { once, name: tokens[0].toLowerCase(), pattern: null }
  }
  const pattern = parsePattern(tokens.slice(1).join(''))
  return pattern ? { once, name: tokens[0].toLowerCase(), pattern } : null
}

/** Beats in a bar, from a {time} value ("3/4" → 3; default 4). */
export function beatsPerBar(time: string | undefined): number {
  const n = Number.parseInt((time ?? '').split('/')[0], 10)
  return n > 0 && n <= 16 ? n : 4
}

/** Each stroke's count ("1", "&", "e", "a"), and whether it starts a beat. */
export function strokeCounts(bar: Stroke[], time: string | undefined): { count: string; beat: boolean }[] {
  const beats = beatsPerBar(time)
  // x/8 time counts every slot ("1 2 3 4 5 6" in 6/8).
  const per = /\/8$/.test(time ?? '') ? 1 : Math.max(1, Math.round(bar.length / beats))
  const subs = per === 2 ? ['', '&'] : per === 3 ? ['', '&', 'a'] : per === 4 ? ['', 'e', '&', 'a'] : ['']
  return bar.map((_, i) => {
    const sub = i % per
    return { count: sub === 0 ? String(Math.floor(i / per) + 1) : (subs[sub] ?? ''), beat: sub === 0 }
  })
}

const WORDS: Record<StrokeKind, string> = { down: 'down', up: 'up', chuck: 'chuck', miss: 'miss' }

/** "down, miss, accented down, up…", for screen readers. */
export function describePattern(p: StrumPattern): string {
  return p.bars
    .map((bar) => bar.map((s) => (s.accent ? `accented ${WORDS[s.kind]}` : WORDS[s.kind])).join(', '))
    .join('; next bar: ')
}

/**
 * The pattern in use at each chord, walking the sheet in order: the
 * sheet's first, then each section's or line's switch. A "once" covers
 * the chord it lands on (a bar) and then the pattern before it resumes.
 */
export function strumsByChord(doc: Doc): Map<Segment, StrumChange> {
  const out = new Map<Segment, StrumChange>()
  let current = doc.strum
  let once: StrumChange | null = null
  const take = (c: StrumChange) => {
    if (c.once) once = c
    else {
      current = c
      once = null
    }
  }
  for (const b of doc.blocks) {
    if (b.strum) take(b.strum)
    for (const l of b.lines) {
      if (l.type === 'strum') take(l.change)
      else if (l.type === 'lyrics')
        for (const s of l.segments) {
          if (!s.chord) continue
          const c = once ?? current
          if (c) out.set(s, c)
          once = null
        }
    }
  }
  return out
}

/**
 * A bar of a pattern as timed strokes over `beats` beats (for the
 * play-through): each slot an equal share of the bar, accents and the
 * downbeat loudest, up strokes lighter. `offset` numbers the strokes after
 * the pattern's earlier bars.
 */
export function strumEvents(bar: Stroke[], beats: number, offset = 0): { beat: number; kind: StrokeKind; level: number; index: number }[] {
  const slot = beats / bar.length
  return bar.map((s, i) => ({
    beat: i * slot,
    kind: s.kind,
    level: s.accent ? 1 : i === 0 ? 0.95 : s.kind === 'up' ? 0.5 : s.kind === 'chuck' ? 0.6 : 0.75,
    index: offset + i,
  }))
}

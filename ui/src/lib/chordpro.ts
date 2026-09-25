import { parseChord, type ChordSymbol } from '@/lib/music'
import { parseStrumDirective, type StrumChange, type StrumPattern } from '@/lib/strum'

// A ChordPro subset: inline [chords], {directives} (title, key, capo,
// comments, chorus/verse/bridge/tab environments), # comments, and
// "[Verse]"-style section headers as found in pasted sheets.

export interface Segment {
  /** Chord above this segment: parsed if it's a chord, raw text if not (e.g. "N.C."). */
  chord: ChordSymbol | null
  chordText: string | null
  text: string
}

export type Line =
  | { type: 'lyrics'; segments: Segment[] }
  | { type: 'comment'; text: string }
  | { type: 'blank' }
  /** The strumming pattern changes here, mid-section. */
  | { type: 'strum'; change: StrumChange }

export interface Block {
  kind: 'verse' | 'chorus' | 'bridge' | 'tab' | 'plain' | 'section'
  label: string | null
  lines: Line[]
  /** Raw lines for tab blocks. */
  tab?: string[]
  /** The strumming pattern this section switches to. */
  strum?: StrumChange
}

export interface Doc {
  meta: Record<string, string>
  blocks: Block[]
  /** The strumming pattern in use from the start, if the sheet has one. */
  strum: StrumChange | null
  /** Every strumming pattern in the sheet, named or not, in order. */
  strums: { name: string | null; pattern: StrumPattern }[]
}

const DIRECTIVE_RE = /^\s*\{\s*([a-z_]+)\s*(?:[:\s]\s*(.*?))?\s*\}\s*$/i
const HEADER_RE = /^\s*\[([^\]]+)\]\s*:?\s*$/
const CHORD_RE = /\[([^\]\n]*)\]/g

const ALIASES: Record<string, string> = {
  t: 'title', st: 'subtitle', c: 'comment', ci: 'comment', cb: 'comment',
  comment_italic: 'comment', comment_box: 'comment', highlight: 'comment',
  soc: 'start_of_chorus', eoc: 'end_of_chorus', sov: 'start_of_verse', eov: 'end_of_verse',
  sob: 'start_of_bridge', eob: 'end_of_bridge', sot: 'start_of_tab', eot: 'end_of_tab',
  chorus: 'chorus_ref',
}

export function parseChordPro(src: string): Doc {
  const meta: Record<string, string> = {}
  const blocks: Block[] = []
  let cur: Block = { kind: 'plain', label: null, lines: [] }
  let inEnv = false
  // Strumming: patterns by name; the one in use from the start (set in the
  // header, before any of the song); a change waiting for what it applies
  // to (a section starting here, or else the next line).
  const named = new Map<string, StrumPattern>()
  const strums: Doc['strums'] = []
  let strum: StrumChange | null = null
  let started = false
  let pending: StrumChange | null = null
  const note = (name: string | null, pattern: StrumPattern) => {
    if (!strums.some((d) => (name ? d.name === name : !d.name && d.pattern.source === pattern.source)))
      strums.push({ name, pattern })
  }
  const flushStrum = () => {
    if (!pending) return
    cur.lines.push({ type: 'strum', change: pending })
    pending = null
  }

  const flush = () => {
    // Trim blank lines at the edges of a block.
    while (cur.lines[0]?.type === 'blank') cur.lines.shift()
    while (cur.lines.at(-1)?.type === 'blank') cur.lines.pop()
    if (cur.lines.length || cur.tab?.length || cur.label) blocks.push(cur)
  }
  const open = (kind: Block['kind'], label: string | null) => {
    flush()
    cur = kind === 'tab' ? { kind, label, lines: [], tab: [] } : { kind, label, lines: [] }
    // A switch just before a section belongs to the section.
    if (pending && (label || kind === 'chorus' || kind === 'bridge')) {
      cur.strum = pending
      pending = null
    }
    started = true
  }

  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    const d = DIRECTIVE_RE.exec(raw)
    if (d) {
      const name = ALIASES[d[1].toLowerCase()] ?? d[1].toLowerCase()
      const value = d[2] ?? ''
      if (name === 'x_strum') {
        const s = parseStrumDirective(value)
        const pattern = s?.pattern ?? (s?.name ? named.get(s.name) : undefined)
        if (!s || !pattern) continue
        if (s.name && s.pattern) named.set(s.name, s.pattern)
        // (A one-bar "once" isn't one of the song's patterns.)
        if (!s.once) note(s.name, pattern)
        const change = { name: s.name, pattern, once: s.once }
        if (started) pending = change
        // In the header, the first pattern is in use from the start; a
        // later named one only defines it (unless it's a switch).
        else if (!s.once && (!strum || !s.pattern || !s.name)) strum = change
        continue
      }
      const env = /^(start|end)_of_([a-z]+)$/.exec(name)
      if (env) {
        const kind = (['chorus', 'verse', 'bridge', 'tab'].includes(env[2]) ? env[2] : 'section') as Block['kind']
        if (env[1] === 'start') {
          open(kind, value || (kind === 'section' ? env[2] : null))
          inEnv = true
        } else {
          open('plain', null)
          inEnv = false
        }
      } else if (name === 'comment') {
        started = true
        flushStrum()
        if (cur.kind === 'tab') cur.tab!.push(value)
        else cur.lines.push({ type: 'comment', text: value })
      } else if (name === 'chorus_ref') {
        open('chorus', value || 'Chorus')
        open('plain', null)
      } else if (value) {
        meta[name] = value
      }
      continue
    }

    if (cur.kind === 'tab') {
      cur.tab!.push(raw)
      started = true
      continue
    }
    if (/^\s*#/.test(raw)) continue

    const h = HEADER_RE.exec(raw)
    if (h && !parseChord(h[1]) && !/^\s*(N\.?C\.?|x\d*|%|\|)\s*$/i.test(h[1])) {
      // "[Verse 1]" starts a new section unless we're inside an explicit
      // {start_of_…} environment, where it's just a label line.
      if (inEnv) cur.lines.push({ type: 'comment', text: h[1] })
      else open(/chorus/i.test(h[1]) ? 'chorus' : /bridge/i.test(h[1]) ? 'bridge' : 'section', h[1].trim())
      continue
    }

    if (!raw.trim()) {
      cur.lines.push({ type: 'blank' })
      continue
    }
    started = true
    flushStrum()
    cur.lines.push({ type: 'lyrics', segments: segments(raw) })
  }
  flush()
  return { meta, blocks, strum, strums }
}

function segments(line: string): Segment[] {
  const out: Segment[] = []
  let last = 0
  let pending: string | null = null
  for (const m of line.matchAll(CHORD_RE)) {
    const text = line.slice(last, m.index)
    if (pending !== null || text) out.push(seg(pending, text))
    pending = m[1]
    last = m.index! + m[0].length
  }
  const rest = line.slice(last)
  if (pending !== null || rest) out.push(seg(pending, rest))
  return out
}

function seg(chordText: string | null, text: string): Segment {
  return { chord: chordText === null ? null : parseChord(chordText), chordText, text }
}

/** Every distinct chord in order of first appearance. */
export function chordsIn(doc: Doc): ChordSymbol[] {
  const seen = new Set<string>()
  const out: ChordSymbol[] = []
  for (const b of doc.blocks)
    for (const l of b.lines)
      if (l.type === 'lyrics')
        for (const s of l.segments)
          if (s.chord) {
            const k = `${s.chord.root}|${s.chord.suffix}|${s.chord.bass}`
            if (!seen.has(k)) {
              seen.add(k)
              out.push(s.chord)
            }
          }
  return out
}

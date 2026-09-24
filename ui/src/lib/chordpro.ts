import { parseChord, type ChordSymbol } from '@/lib/music'

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

export interface Block {
  kind: 'verse' | 'chorus' | 'bridge' | 'tab' | 'plain' | 'section'
  label: string | null
  lines: Line[]
  /** Raw lines for tab blocks. */
  tab?: string[]
}

export interface Doc {
  meta: Record<string, string>
  blocks: Block[]
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

  const flush = () => {
    // Trim blank lines at the edges of a block.
    while (cur.lines[0]?.type === 'blank') cur.lines.shift()
    while (cur.lines.at(-1)?.type === 'blank') cur.lines.pop()
    if (cur.lines.length || cur.tab?.length || cur.label) blocks.push(cur)
  }
  const open = (kind: Block['kind'], label: string | null) => {
    flush()
    cur = kind === 'tab' ? { kind, label, lines: [], tab: [] } : { kind, label, lines: [] }
  }

  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    const d = DIRECTIVE_RE.exec(raw)
    if (d) {
      const name = ALIASES[d[1].toLowerCase()] ?? d[1].toLowerCase()
      const value = d[2] ?? ''
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
    cur.lines.push({ type: 'lyrics', segments: segments(raw) })
  }
  flush()
  return { meta, blocks }
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

import { parseChord } from '@/lib/music'

// Converts the "chords on their own line above the lyrics" layout most
// sheets on the web use into ChordPro with inline [chords].

const FILLER_RE = /^(\||\|\||x\d+|\d+x|\(|\)|-+|\/|%|N\.?C\.?|\.{2,}|:?\|:?)$/i
const SECTION_RE = /^\s*\(?(intro|verse|pre-?chorus|chorus|bridge|outro|solo|interlude|instrumental|refrain|coda|hook|break|riff|ending)\b[^:]*:?\)?\s*$/i
const TAB_RE = /^\s*[a-gA-G][#b]?\s*[|:]?[-0-9|hpbrxs/\\~().^* ]{4,}\|?\s*$/

function tokens(line: string): { text: string; col: number }[] {
  return [...line.matchAll(/\S+/g)].map((m) => ({ text: m[0], col: m.index! }))
}

export function isChordLine(line: string): boolean {
  const toks = tokens(line)
  if (!toks.length) return false
  let chords = 0
  for (const t of toks) {
    const bare = t.text.replace(/^\(|\)$/g, '')
    if (parseChord(bare)) chords++
    else if (!FILLER_RE.test(bare)) return false
  }
  return chords > 0
}

function inline(chordLine: string, lyric: string): string {
  let out = lyric
  for (const t of tokens(chordLine).reverse()) {
    if (out.length < t.col) out = out.padEnd(t.col)
    out = out.slice(0, t.col) + `[${t.text}]` + out.slice(t.col)
  }
  return out.trimEnd()
}

export function chordsOverLyricsToChordPro(src: string): string {
  const lines = src.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')
  const out: string[] = []
  let inTab = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const isTab = TAB_RE.test(line) && !isChordLine(line)
    if (isTab !== inTab) {
      out.push(isTab ? '{start_of_tab}' : '{end_of_tab}')
      inTab = isTab
    }
    if (isTab) {
      out.push(line)
      continue
    }
    if (SECTION_RE.test(line) && !/^\s*\[/.test(line)) {
      out.push(`[${line.trim().replace(/^\(|\)$|:$/g, '').trim()}]`)
      continue
    }
    if (isChordLine(line)) {
      const next = lines[i + 1]
      if (next !== undefined && next.trim() && !isChordLine(next) && !SECTION_RE.test(next) &&
        !TAB_RE.test(next) && !/^\s*[[{]/.test(next)) {
        out.push(inline(line, next))
        i++
      } else {
        out.push(inline(line, ''))
      }
      continue
    }
    out.push(line.trimEnd())
  }
  if (inTab) out.push('{end_of_tab}')
  return out.join('\n')
}

/** True if text looks like chords-over-lyrics rather than ChordPro. */
export function looksLikeChordsOverLyrics(src: string): boolean {
  if (/\[[A-G][^\]]*\]\S/.test(src)) return false
  return src.split('\n').some(isChordLine)
}

/**
 * How long each chord of a sheet lasts, in beats, for playing it through.
 * ChordPro doesn't say, so this reads it off the lyrics: a chord lasts
 * until the next one, wherever that is (often over a line break:
 * "[C/G]Love of mine / someday [Am/E]you…" holds C/G through "someday"),
 * at about SYLLABLES_PER_BEAT sung syllables a beat, plus a held beat or
 * two at each line end it spans. Chords on a line of their own (intros,
 * turnarounds) get a bar each. Everything snaps to half bars.
 */
import type { Doc } from '@/lib/chordpro'

const SYLLABLES_PER_BEAT = 1.5
const LINE_END_BEATS = 1.5
const BAR = 4
const MIN_BEATS = 2
const MAX_BEATS = 8

/**
 * A rough syllable count: vowel groups per word, less a silent final e.
 * A piece with no vowel ("d" of "d[G]ark") is 0: it's part of a word the
 * next chord's text finishes.
 */
export function syllables(text: string): number {
  let n = 0
  for (const word of text.toLowerCase().match(/[a-z']+/g) ?? []) {
    const groups = word.match(/[aeiouy]+/g)?.length ?? 0
    const silentE = groups > 1 && /[^aeiouy]e$/.test(word) && !/[^aeiouy]le$/.test(word) ? 1 : 0
    if (groups) n += Math.max(1, groups - silentE)
  }
  return n
}

/** Beats for each parsed chord, in the order playAlongChords lists them. */
export function chordBeats(doc: Doc): number[] {
  const sung: number[] = [] // syllables sung over each chord
  const ends: number[] = [] // line ends each chord is held across
  const fixed: boolean[] = [] // chord-only lines: a bar each
  let current = -1
  for (const block of doc.blocks) {
    for (const line of block.lines) {
      if (line.type !== 'lyrics') continue
      const hasText = line.segments.some((s) => s.text.trim())
      for (const s of line.segments) {
        if (s.chord) {
          current = sung.length
          sung.push(0)
          ends.push(0)
          fixed.push(!hasText)
        }
        if (current >= 0) sung[current] += syllables(s.text)
      }
      if (hasText && current >= 0) ends[current]++
    }
  }
  return sung.map((n, i) => {
    if (fixed[i]) return BAR
    const beats = n / SYLLABLES_PER_BEAT + ends[i] * LINE_END_BEATS
    return Math.min(MAX_BEATS, Math.max(MIN_BEATS, Math.round(beats / 2) * 2))
  })
}

/** Chord qualities we know tones (and so guitar shapes) for. */
export type Quality =
  | 'maj' | 'min' | 'dim' | 'aug' | 'min6' | 'maj6' | 'min7' | 'minmaj7' | 'maj7' | '7'
  | 'dim7' | 'hdim7' | 'sus2' | 'sus4' | '5' | 'add9' | '9' | 'min9' | 'maj9' | '7sus4'

export interface Chord {
  root: number
  quality: Quality
  /** A slash chord's bass note (pitch class), when it isn't the root. */
  bass?: number | null
}

/** A chord symbol as written: root and bass transpose, the suffix is kept verbatim. */
export interface ChordSymbol {
  root: number
  /** Suffix as written after the root, e.g. "m7", "sus4", "add9". */
  suffix: string
  bass: number | null
  /** Known quality for diagrams, when the suffix maps to one. */
  quality: Quality | null
  /** True if the root was spelled with a flat. */
  flat: boolean
}

export const mod12 = (n: number) => ((n % 12) + 12) % 12

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

export function noteName(pc: number, flats: boolean): string {
  return (flats ? FLAT_NAMES : SHARP_NAMES)[mod12(pc)]
}

/** Pretty accidentals for display. */
export const pretty = (s: string) => s.replace(/#/g, '♯').replace(/(?<=[A-G])b/g, '♭')

function parseNote(s: string): { pc: number; flat: boolean } | null {
  const m = /^([A-G])([#b♯♭]?)$/.exec(s)
  if (!m) return null
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0
  return { pc: mod12(LETTER[m[1]] + acc), flat: acc < 0 }
}

// Suffix spellings → quality. Anything else that looks like a chord
// suffix still parses (and transposes); it just gets no diagram.
const QUALITIES: [RegExp, Quality][] = [
  [/^(|M|maj|major)$/, 'maj'],
  [/^(m|min|minor|-)$/, 'min'],
  [/^(dim|°|o)$/, 'dim'],
  [/^(aug|\+|\+5|#5)$/, 'aug'],
  [/^(m6|min6|-6)$/, 'min6'],
  [/^(6|maj6|M6)$/, 'maj6'],
  [/^(m7|min7|-7)$/, 'min7'],
  [/^(mmaj7|mM7|m\(maj7\)|minmaj7|-maj7|-Δ7?)$/, 'minmaj7'],
  [/^(maj7|M7|Δ|Δ7|ma7)$/, 'maj7'],
  [/^(7|dom7)$/, '7'],
  [/^(dim7|°7|o7)$/, 'dim7'],
  [/^(m7b5|m7♭5|min7b5|ø|ø7|-7b5)$/, 'hdim7'],
  [/^(sus2|2)$/, 'sus2'],
  [/^(sus4|sus)$/, 'sus4'],
  [/^5$/, '5'],
  [/^(add9|add2)$/, 'add9'],
  [/^9$/, '9'],
  [/^(m9|min9|-9)$/, 'min9'],
  [/^(maj9|M9|Δ9)$/, 'maj9'],
  [/^(7sus4|7sus|sus7)$/, '7sus4'],
]

// What a chord suffix may contain; keeps "[Verse]" and "[Bridge]" from
// parsing as chords.
const SUFFIX_RE = /^(maj|min|mi|ma|m|M|dim|aug|sus|add|alt|dom|no|omit|°|ø|Δ|\+|-|\(|\)|[0-9#b♯♭,\/]|\s)*$/

export function parseChord(text: string): ChordSymbol | null {
  const m = /^([A-G][#b♯♭]?)(.*?)(?:\/([A-G][#b♯♭]?))?$/.exec(text.trim())
  if (!m) return null
  const root = parseNote(m[1])
  if (!root || !SUFFIX_RE.test(m[2])) return null
  const bass = m[3] ? parseNote(m[3]) : null
  const suffix = m[2]
  const quality = QUALITIES.find(([re]) => re.test(suffix))?.[1] ?? null
  return { root: root.pc, suffix, bass: bass?.pc ?? null, quality, flat: root.flat }
}

export function transposeSymbol(c: ChordSymbol, semitones: number): ChordSymbol {
  return {
    ...c,
    root: mod12(c.root + semitones),
    bass: c.bass === null ? null : mod12(c.bass + semitones),
  }
}

export function symbolText(c: ChordSymbol, flats: boolean, simplify = false): string {
  let suffix = c.suffix
  if (simplify) {
    const q = c.quality ? SIMPLE[c.quality] : /^(m|min|-)(?!aj)/.test(suffix) ? 'min' : 'maj'
    suffix = q === 'min' ? 'm' : q === 'dim' ? 'dim' : q === 'aug' ? 'aug' : q === 'sus2' ? 'sus2' : q === 'sus4' ? 'sus4' : q === '5' ? '5' : ''
    return noteName(c.root, flats) + suffix
  }
  return noteName(c.root, flats) + suffix + (c.bass === null ? '' : '/' + noteName(c.bass, flats))
}

/** Reduce extensions to the triad a beginner would strum. */
const SIMPLE: Record<Quality, Quality> = {
  maj: 'maj', min: 'min', dim: 'dim', aug: 'aug', min6: 'min', maj6: 'maj', min7: 'min',
  minmaj7: 'min', maj7: 'maj', '7': 'maj', dim7: 'dim', hdim7: 'dim', sus2: 'sus2',
  sus4: 'sus4', '5': '5', add9: 'maj', '9': 'maj', min9: 'min', maj9: 'maj', '7sus4': 'sus4',
}

export function simplifyQuality(q: Quality): Quality {
  return SIMPLE[q]
}

// Tonics (pitch classes) whose key signatures use flats.
const FLAT_MAJOR_TONICS = new Set([5, 10, 3, 8, 1])
const FLAT_MINOR_TONICS = new Set([2, 7, 0, 5, 10, 3])

export interface Key {
  tonic: number
  minor: boolean
}

export function parseKey(s: string): Key | null {
  const c = parseChord(s.replace(/\s*(major|maj)$/i, '').replace(/\s*minor$/i, 'm'))
  if (!c) return null
  return { tonic: c.root, minor: c.quality === 'min' }
}

export function keyUsesFlats(k: Key): boolean {
  return k.minor ? FLAT_MINOR_TONICS.has(k.tonic) : FLAT_MAJOR_TONICS.has(k.tonic)
}

export function keyText(k: Key, flats: boolean): string {
  return noteName(k.tonic, flats) + (k.minor ? 'm' : '')
}

import { mod12, type Chord, type Quality } from '@/lib/music'
import { instrumentFor, STANDARD_STRINGS } from '@/lib/tunings'

/** Fret per string, lowest string first; null = not played, 0 = open. */
export type Frets = (number | null)[]

export interface Voicing {
  frets: Frets
  /** Fret of a full/partial barre, drawn as a bar across the strings. */
  barre?: { fret: number; from: number; to: number }
  /** True for first-position shapes with no barre. */
  open: boolean
}

const x = null

// Open-position shapes that aren't just E/A shapes at fret 0 (those come
// from the movable shapes below). Keyed by `${root}:${quality}`.
const OPEN: Record<string, Frets> = {
  '0:maj': [x, 3, 2, 0, 1, 0],
  '0:maj7': [x, 3, 2, 0, 0, 0],
  '0:7': [x, 3, 2, 3, 1, 0],
  '0:maj6': [x, 3, 2, 2, 1, 0],
  '0:sus2': [x, 3, 0, 0, 1, 3],
  '0:sus4': [x, 3, 3, 0, 1, 1],
  '2:maj': [x, x, 0, 2, 3, 2],
  '2:min': [x, x, 0, 2, 3, 1],
  '2:7': [x, x, 0, 2, 1, 2],
  '2:maj7': [x, x, 0, 2, 2, 2],
  '2:min7': [x, x, 0, 2, 1, 1],
  '2:maj6': [x, x, 0, 2, 0, 2],
  '2:min6': [x, x, 0, 2, 0, 1],
  '2:sus2': [x, x, 0, 2, 3, 0],
  '2:sus4': [x, x, 0, 2, 3, 3],
  '2:dim': [x, x, 0, 1, 3, 1],
  '2:dim7': [x, x, 0, 1, 0, 1],
  '2:hdim7': [x, x, 0, 1, 1, 1],
  '5:maj7': [x, x, 3, 2, 1, 0],
  '7:maj': [3, 2, 0, 0, 0, 3],
  '7:7': [3, 2, 0, 0, 0, 1],
  '7:maj7': [3, 2, 0, 0, 0, 2],
  '7:maj6': [3, 2, 0, 0, 0, 0],
  '7:sus4': [3, x, 0, 0, 1, 3],
  '7:sus2': [3, 0, 0, 2, 3, 3],
  '11:7': [x, 2, 1, 2, 0, 2],
  '11:min7': [x, 2, 0, 2, 0, 2],
}

// Movable shapes as offsets from the root fret. E shapes put the root on
// the low E string, A shapes on the A string. At fret 0 they're the open
// E and A chord families.
const E_SHAPES: Partial<Record<Quality, Frets>> = {
  maj: [0, 2, 2, 1, 0, 0],
  min: [0, 2, 2, 0, 0, 0],
  '7': [0, 2, 0, 1, 0, 0],
  min7: [0, 2, 0, 0, 0, 0],
  maj7: [0, x, 1, 1, 0, x],
  maj6: [0, 2, 2, 1, 2, 0],
  min6: [0, 2, 2, 0, 2, 0],
  minmaj7: [0, 2, 1, 0, 0, 0],
  sus4: [0, 2, 2, 2, 0, 0],
  aug: [0, 3, 2, 1, 1, 0],
  dim: [0, 1, 2, 0, x, x],
  dim7: [0, x, -1, 0, -1, 0],
  hdim7: [0, x, 0, 0, -1, x],
  '5': [0, 2, 2, x, x, x],
}

const A_SHAPES: Partial<Record<Quality, Frets>> = {
  maj: [x, 0, 2, 2, 2, 0],
  min: [x, 0, 2, 2, 1, 0],
  '7': [x, 0, 2, 0, 2, 0],
  min7: [x, 0, 2, 0, 1, 0],
  maj7: [x, 0, 2, 1, 2, 0],
  maj6: [x, 0, 2, 2, 2, 2],
  min6: [x, 0, 2, 2, 1, 2],
  minmaj7: [x, 0, 2, 1, 1, 0],
  sus2: [x, 0, 2, 2, 0, 0],
  sus4: [x, 0, 2, 2, 3, 0],
  aug: [x, 0, 3, 2, 2, 1],
  dim: [x, 0, 1, 2, 1, x],
  dim7: [x, 0, 1, 2, 1, 2],
  hdim7: [x, 0, 1, 0, 1, x],
  '5': [x, 0, 2, 2, x, x],
}

function place(shape: Frets, rootFret: number, rootString: number): Voicing | null {
  const frets = shape.map((o) => (o === null ? null : o + rootFret))
  if (frets.some((f) => f !== null && f < 0)) return null
  if (rootFret === 0) return { frets, open: true }
  // Barre across every played string sitting at the root fret.
  const atRoot = frets
    .map((f, i) => (f === rootFret ? i : -1))
    .filter((i) => i >= rootString)
  const to = atRoot.length ? Math.max(...atRoot) : rootString
  return {
    frets,
    open: false,
    barre: to > rootString ? { fret: rootFret, from: rootString, to } : undefined,
  }
}

/**
 * Candidate voicings for a chord on a guitar tuned to `strings` (open-string
 * MIDI pitches), easiest first. Standard tuning uses the hand-checked shapes
 * above; any other tuning searches the fretboard.
 */
export function voicings(chord: Chord, strings: number[] = STANDARD_STRINGS): Voicing[] {
  const instrument = instrumentFor(strings)
  // A ukulele has no low bass note to put under a chord (its G string is
  // re-entrant): a slash chord is played as its chord.
  if (isSlash(chord) && instrument === 'ukulele') chord = { root: chord.root, quality: chord.quality }
  // On guitar, a slash chord wants its bass note lowest: search for those,
  // falling back to the plain chord if nothing's playable.
  if (isSlash(chord) && instrument === 'guitar') {
    const key = `${strings.join(',')}|${chordId(chord)}`
    let found = searchCache.get(key)
    if (!found) {
      found = searchVoicings(chord, strings)
      if (!found.length) found = voicings({ root: chord.root, quality: chord.quality }, strings)
      searchCache.set(key, found)
    }
    return found
  }
  if (isStandardGuitar(strings)) return standardVoicings(chord)
  const key = `${strings.join(',')}|${chordId(chord)}`
  let found = searchCache.get(key)
  if (!found) {
    found = instrumentFor(strings) === 'bass' ? bassVoicings(chord, strings) : searchVoicings(chord, strings)
    const chart = strings.every((s, i) => s === UKULELE[i]) ? UKULELE_CHART[`${chord.root}:${chord.quality}`] : undefined
    if (chart) {
      const key = chart.join(',')
      found = [voicingFromFrets(chart), ...found.filter((v) => v.frets.join(',') !== key)]
    }
    searchCache.set(key, found)
  }
  return found
}

// Ukulele shapes charts print where the search's easiest pick differs
// (it prefers Em 0402, say). Standard GCEA tuning only.
const UKULELE_CHART: Record<string, Frets> = {
  '4:min': [0, 4, 3, 2],
  '4:maj': [4, 4, 4, 2],
  '11:min': [4, 2, 2, 2],
  '11:maj': [4, 3, 2, 2],
  '2:7': [2, 2, 2, 3],
}
const UKULELE = [67, 60, 64, 69]

/** A slash chord whose bass isn't its root ("Em7/D"). */
const isSlash = (c: Chord) => c.bass !== undefined && c.bass !== null && c.bass !== c.root
const chordId = (c: Chord) => `${c.root}:${c.quality}${isSlash(c) ? `/${c.bass}` : ''}`

const isStandardGuitar = (strings: number[]) =>
  strings.length === STANDARD_STRINGS.length && strings.every((s, i) => s === STANDARD_STRINGS[i])

/**
 * Bass shapes: root, fifth and octave across three strings (what a
 * bassist reads a chord chart for), lowest on the neck first.
 */
function bassVoicings(chord: Chord, strings: number[]): Voicing[] {
  const fifth = TONES[chord.quality].find((i) => i === 7 || i === 6 || i === 8) ?? 7
  // A slash chord's bass note is what the bass plays: it and its octave.
  const slash = isSlash(chord)
  const low = slash ? chord.bass! : chord.root
  const out: Voicing[] = []
  for (let s = 0; s + 2 < strings.length; s++) {
    for (let r = 0; r <= 12; r++) {
      const root = strings[s] + r
      if (mod12(root) !== low) continue
      const f5 = slash ? null : root + fifth - strings[s + 1]
      const f8 = root + 12 - strings[s + 2]
      const fretted = [r, f5 ?? 0, f8].filter((f) => f > 0)
      if ((f5 !== null && (f5 < 0 || f5 > 15)) || f8 < 0 || f8 > 15) continue
      if (fretted.length && Math.max(...fretted) - Math.min(...fretted) > 3) continue
      const frets: Frets = strings.map(() => null)
      frets[s] = r
      frets[s + 1] = f5
      frets[s + 2] = f8
      out.push({ frets, open: Math.max(r, f5 ?? 0, f8) <= 4 })
    }
  }
  return out.sort((a, b) => lowestFret(a) - lowestFret(b))
}

// Searching takes ~1 ms a chord and capo suggestions ask for many.
const searchCache = new Map<string, Voicing[]>()

const MAX_SHAPES = 8

/**
 * Voicings to cycle through for a chord, at most eight: the one
 * `voicings` would show first, the rest of the hand-checked shapes, then
 * the best of the fretboard search, the extras ordered up the neck.
 */
export function shapesFor(chord: Chord, strings: number[] = STANDARD_STRINGS): Voicing[] {
  const key = `shapes|${strings.join(',')}|${chordId(chord)}`
  let out = searchCache.get(key)
  if (out) return out
  if (instrumentFor(strings) === 'ukulele' && isSlash(chord)) chord = { root: chord.root, quality: chord.quality }
  if (instrumentFor(strings) === 'bass') {
    out = voicings(chord, strings).slice(0, MAX_SHAPES)
    searchCache.set(key, out)
    return out
  }
  const standardStrings = isStandardGuitar(strings)
  const standard = standardStrings && !isSlash(chord)
  const head = standard ? standardVoicings(chord) : voicings(chord, strings).slice(0, 1)
  const seen = new Set(head.map((v) => v.frets.join(',')))
  let searched = searchCache.get(`std|${chord.root}:${chord.quality}`)
  if (standard && !searched) {
    searched = searchVoicings(chord, STANDARD_STRINGS)
    searchCache.set(`std|${chord.root}:${chord.quality}`, searched)
  }
  const pool = standard ? searched! : voicings(chord, strings)
  const chosen = [...head]
  for (const v of pool) {
    if (chosen.length >= MAX_SHAPES) break
    if (seen.has(v.frets.join(',')) || !sensible(v, standardStrings)) continue
    // Not just a chosen shape with strings left out.
    if (chosen.some((u) => v.frets.every((f, i) => f === null || f === u.frets[i]))) continue
    // At most two shapes around any one spot on the neck.
    if (chosen.filter((u) => Math.abs(lowestFret(u) - lowestFret(v)) <= 1).length >= 2) continue
    chosen.push(v)
  }
  const extra = chosen.slice(head.length).sort((a, b) => lowestFret(a) - lowestFret(b))
  out = [...head, ...extra]
  searchCache.set(key, out)
  return out
}

function standardVoicings(chord: Chord): Voicing[] {
  const out: Voicing[] = []
  const open = OPEN[`${chord.root}:${chord.quality}`]
  if (open) out.push({ frets: open, open: true })

  const eShape = E_SHAPES[chord.quality]
  const aShape = A_SHAPES[chord.quality]
  const eFret = mod12(chord.root - 4)
  const aFret = mod12(chord.root - 9)
  const moved: Voicing[] = []
  for (const [shape, fret, string] of [
    [eShape, eFret, 0],
    [aShape, aFret, 1],
  ] as const) {
    if (!shape) continue
    const v = place(shape, fret, string) ?? place(shape, fret + 12, string)
    if (v) moved.push(v)
  }
  moved.sort((a, b) => Number(b.open) - Number(a.open) || lowestFret(a) - lowestFret(b))
  out.push(...moved)
  // Extended chords (add9, 9, 7sus4...) have no hand-checked shapes.
  if (!out.length) {
    const key = `std|${chord.root}:${chord.quality}`
    let found = searchCache.get(key)
    if (!found) {
      found = searchVoicings(chord, STANDARD_STRINGS)
      searchCache.set(key, found)
    }
    return found
  }
  return out
}

/**
 * A shape worth offering: the hand stays within four frets, and in
 * standard tuning, the top strings ring (at most one muted) and open
 * strings only in first position (an open string
 * under fingers at the seventh fret is a shape nobody reaches for). Open
 * tunings keep them: drones under high frets are how those are played.
 */
function sensible(v: Voicing, standard: boolean): boolean {
  const fretted = v.frets.filter((f): f is number => f !== null && f > 0)
  if (!fretted.length) return true
  const hi = Math.max(...fretted)
  if (hi - Math.min(...fretted) > 3) return false
  // Strummed chords ring the top strings: at most one left out.
  if (standard && v.frets[v.frets.length - 1] === null && v.frets[v.frets.length - 2] === null) return false
  if (hi < 5) return true
  if (standard) return !v.frets.includes(0)
  const first = v.frets.findIndex((f) => f !== null)
  return v.frets.every((f, i) => f !== 0 || i === first)
}

/** A shape from bare frets (a sheet's own voicing): works out the barre. */
export function voicingFromFrets(frets: Frets): Voicing {
  const fretted = frets.flatMap((f, s) => (f !== null && f > 0 ? [s] : []))
  const values = fretted.map((s) => frets[s]!)
  let barre: Voicing['barre']
  if (fretted.length > 4) {
    const min = Math.min(...values)
    const atMin = fretted.filter((s) => frets[s] === min)
    const last = frets.reduce<number>((l, f, s) => (f !== null ? s : l), -1)
    const from = atMin[0]
    if (atMin.length >= 2 && frets.slice(from, last + 1).every((f) => f !== 0)) barre = { fret: min, from, to: last }
  }
  const max = values.length ? Math.max(...values) : 0
  return { frets: [...frets], barre, open: !barre && max <= 4 }
}

/** Frets as a stable key, "x,3,2,0,1,0". */
export const fretsKey = (f: Frets) => f.map((x) => (x === null ? 'x' : x)).join(',')

/** Frets as players write them: "x32010", or spaced once past fret 9. */
export function fretsText(f: Frets): string {
  return f.map((x) => (x === null ? 'x' : String(x))).join(f.some((x) => x !== null && x > 9) ? ' ' : '')
}

/**
 * Parses "x32010", "x 3 2 0 1 0" or "8,10,10,9,8,8" for an instrument
 * with `strings` strings; null if it isn't that.
 */
export function parseFrets(text: string, strings: number): Frets | null {
  const t = text.trim().toLowerCase()
  if (!t) return null
  const parts = /[\s,]/.test(t) ? t.split(/[\s,]+/) : [...t]
  if (parts.length !== strings) return null
  const out: Frets = []
  for (const p of parts) {
    if (p === 'x' || p === '-1') out.push(null)
    else if (/^\d{1,2}$/.test(p) && Number(p) <= 24) out.push(Number(p))
    else return null
  }
  return out.every((f) => f === null) ? null : out
}

/** Record frets (-1 = not played) to Frets, and back. */
export const fromRecordFrets = (f: number[]): Frets => f.map((x) => (x < 0 ? null : x))
export const toRecordFrets = (f: Frets): number[] => f.map((x) => (x === null ? -1 : x))

function lowestFret(v: Voicing): number {
  const fretted = v.frets.filter((f): f is number => f !== null && f > 0)
  return fretted.length ? Math.min(...fretted) : 0
}

/** How hard a chord is to grab: 0 open, ~1 low barre, more up the neck. */
function difficulty(chord: Chord, strings: number[]): number {
  const v = voicings(chord, strings)[0]
  if (!v) return 3
  if (v.open) return 0
  return 1 + lowestFret(v) / 12
}

/**
 * The capo position (0–7) that makes the song's chords easiest, weighing
 * each chord by how long it's played. Ties go to the lower capo.
 */
export function suggestCapo(
  chords: { chord: Chord; seconds: number }[],
  strings: number[] = STANDARD_STRINGS,
): number {
  let best = 0
  let bestScore = Infinity
  let noCapo = Infinity
  for (let capo = 0; capo <= 7; capo++) {
    let score = 0
    for (const { chord, seconds } of chords) {
      score += difficulty({ root: mod12(chord.root - capo), quality: chord.quality }, strings) * seconds
    }
    // Each fret of capo costs a little, so it only wins by being easier.
    score *= 1 + capo * 0.08
    if (capo === 0) noCapo = score
    if (score < bestScore - 1e-6) {
      bestScore = score
      best = capo
    }
  }
  // And clearly easier: at least a fifth less work than no capo at all.
  return bestScore < noCapo * 0.8 ? best : 0
}

/** Intervals above the root; the fifth (7) may be left out of chords of 4+ notes. */
const TONES: Record<Quality, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  min6: [0, 3, 7, 9],
  maj6: [0, 4, 7, 9],
  min7: [0, 3, 7, 10],
  minmaj7: [0, 3, 7, 11],
  maj7: [0, 4, 7, 11],
  '7': [0, 4, 7, 10],
  dim7: [0, 3, 6, 9],
  hdim7: [0, 3, 6, 10],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  '5': [0, 7],
  add9: [0, 4, 7, 2],
  '9': [0, 4, 7, 10, 2],
  min9: [0, 3, 7, 10, 2],
  maj9: [0, 4, 7, 11, 2],
  '7sus4': [0, 5, 7, 10],
}

/** Chord tones as pitch classes, for checking voicings. */
export function chordTones(chord: Chord): number[] {
  return TONES[chord.quality].map((i) => mod12(chord.root + i))
}

const SEARCH_WINDOW = 4 // frets a hand covers without stretching
const MAX_FRET = 12

/**
 * Every playable voicing within reach: root in the bass, every chord tone
 * present (the fifth may drop out of 4-note chords), no muted string between
 * sounding ones, at least four strings, and at most four fingers (a barre
 * across the lowest fretted fret counts as one).
 */
function searchVoicings(chord: Chord, strings: number[]): Voicing[] {
  const ukulele = instrumentFor(strings) === 'ukulele'
  // The lowest note: a slash chord's bass, else the root.
  const lowest = isSlash(chord) && !ukulele ? chord.bass! : chord.root
  const tones = new Set([...chordTones(chord), lowest])
  const required = [
    ...TONES[chord.quality].filter((i) => !(i === 7 && TONES[chord.quality].length >= 4)).map((i) => mod12(chord.root + i)),
    lowest,
  ]

  const found = new Map<string, { v: Voicing; score: number }>()
  for (let base = 0; base <= MAX_FRET - SEARCH_WINDOW + 1; base++) {
    const lo = Math.max(1, base)
    const options = strings.map((open) => {
      const frets: (number | null)[] = [null]
      if (tones.has(mod12(open))) frets.push(0)
      for (let f = lo; f < lo + SEARCH_WINDOW; f++) if (tones.has(mod12(open + f))) frets.push(f)
      return frets
    })
    const pick: (number | null)[] = []
    const walk = (s: number) => {
      if (s === strings.length) {
        const v = judge(pick, strings, lowest, required, ukulele)
        if (v) {
          const key = v.v.frets.join(',')
          const prev = found.get(key)
          if (!prev || v.score < prev.score) found.set(key, v)
        }
        return
      }
      for (const f of options[s]) {
        pick.push(f)
        walk(s + 1)
        pick.pop()
      }
    }
    walk(0)
  }
  return [...found.values()].sort((a, b) => a.score - b.score).map((f) => f.v)
}

function judge(
  frets: (number | null)[],
  strings: number[],
  root: number,
  required: number[],
  ukulele = false,
): { v: Voicing; score: number } | null {
  const sounding = frets.flatMap((f, s) => (f === null ? [] : [s]))
  // Ukulele chords ring every string, and the root needn't be lowest (the
  // G string is re-entrant, so "lowest" isn't even the first string).
  if (sounding.length < (ukulele ? strings.length : 4)) return null
  const first = sounding[0]
  const last = sounding[sounding.length - 1]
  if (last - first + 1 !== sounding.length) return null // muted string in the middle
  if (!ukulele && mod12(strings[first] + frets[first]!) !== root) return null

  const pcs = new Set(sounding.map((s) => mod12(strings[s] + frets[s]!)))
  if (!required.every((t) => pcs.has(t))) return null

  const fretted = sounding.filter((s) => frets[s]! > 0)
  const opens = sounding.length - fretted.length
  const minFret = fretted.length ? Math.min(...fretted.map((s) => frets[s]!)) : 0
  let fingers = fretted.length
  let barre: Voicing['barre']
  if (fingers > 4) {
    // Try a barre across the lowest fret: it must cover every sounding
    // string from its first to its last, with no open string underneath.
    const atMin = fretted.filter((s) => frets[s] === minFret)
    const from = atMin[0]
    const to = last
    const covered = sounding.filter((s) => s >= from && s <= to)
    if (atMin.length < 2 || covered.some((s) => frets[s] === 0)) return null
    fingers = 1 + fretted.filter((s) => frets[s]! > minFret).length
    if (fingers > 4) return null
    barre = { fret: minFret, from, to }
  }

  const maxFret = fretted.length ? Math.max(...fretted.map((s) => frets[s]!)) : 0
  const score =
    // Fuller chords win ties: x20003 over x2000x for G/B.
    minFret * 0.6 + fingers * 0.5 + (barre ? 1.5 : 0) - opens * 0.3 - sounding.length * 0.6
  // First position without a stretch counts as an open chord.
  const open = !barre && maxFret <= 4 && maxFret - minFret <= 2
  return { v: { frets: [...frets], barre, open }, score }
}

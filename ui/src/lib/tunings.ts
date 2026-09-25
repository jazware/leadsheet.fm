// Ids match the fm.leadsheet.sheet `tuning` knownValues. "standard" (or
// no tuning) is each instrument's own standard.

export type Instrument = 'guitar' | 'ukulele' | 'bass'

/** The instrument a sheet kind is for: chords and tab are guitar. */
export const instrumentOf = (kind: string | null | undefined): Instrument =>
  kind === 'ukulele' ? 'ukulele' : kind === 'bass' ? 'bass' : 'guitar'

export interface Tuning {
  id: string
  name: string
  instrument: Instrument
  /** Open-string MIDI pitches, in the order the strings are drawn (low E side first on guitar and bass, G first on ukulele). */
  strings: number[]
  /**
   * Semitones the chart is written above the sounding pitch. Tunings that
   * are standard shifted down (E♭, D standard) are played with standard
   * shapes, so they work like a capo in reverse; everything else is
   * written at pitch with shapes found for the tuning itself.
   */
  shift: number
}

export const STANDARD_STRINGS = [40, 45, 50, 55, 59, 64]
const UKULELE_STRINGS = [67, 60, 64, 69] // G4 C4 E4 A4, re-entrant
const BASS_STRINGS = [28, 33, 38, 43]

const guitar = (id: string, name: string, strings: number[], shift = 0): Tuning => ({ id, name, instrument: 'guitar', strings, shift })
const ukulele = (id: string, name: string, strings: number[]): Tuning => ({ id, name, instrument: 'ukulele', strings, shift: 0 })
const bass = (id: string, name: string, strings: number[], shift = 0): Tuning => ({ id, name, instrument: 'bass', strings, shift })

export const TUNINGS: Tuning[] = [
  guitar('standard', 'Standard', STANDARD_STRINGS),
  guitar('eb-standard', 'Half step down', [39, 44, 49, 54, 58, 63], 1),
  guitar('d-standard', 'Whole step down', [38, 43, 48, 53, 57, 62], 2),
  guitar('drop-d', 'Drop D', [38, 45, 50, 55, 59, 64]),
  guitar('drop-c', 'Drop C', [36, 43, 48, 53, 57, 62]),
  guitar('dadgad', 'DADGAD', [38, 45, 50, 55, 57, 62]),
  guitar('open-d', 'Open D', [38, 45, 50, 54, 57, 62]),
  guitar('open-g', 'Open G', [38, 43, 50, 55, 59, 62]),
  guitar('open-e', 'Open E', [40, 47, 52, 56, 59, 64]),
  guitar('open-c', 'Open C', [36, 43, 48, 55, 60, 64]),
  ukulele('standard', 'Standard (GCEA)', UKULELE_STRINGS),
  ukulele('low-g', 'Low G', [55, 60, 64, 69]),
  ukulele('baritone', 'Baritone (DGBE)', [50, 55, 59, 64]),
  bass('standard', 'Standard (EADG)', BASS_STRINGS),
  bass('eb-standard', 'Half step down', [27, 32, 37, 42], 1),
  bass('d-standard', 'Whole step down', [26, 31, 36, 41], 2),
  bass('drop-d', 'Drop D', [26, 33, 38, 43]),
  bass('five-string', 'Five-string (BEADG)', [23, 28, 33, 38, 43]),
]

/** The tunings offered for a sheet kind. */
export const tuningsFor = (kind: string | null | undefined) => TUNINGS.filter((t) => t.instrument === instrumentOf(kind))

/** A sheet's tuning; the instrument's standard when unset or not one of its tunings. */
export function getTuning(id: string | null | undefined, kind: string | null | undefined = 'chords'): Tuning {
  const options = tuningsFor(kind)
  return options.find((t) => t.id === id) ?? options[0]
}

/** The strings the chord shapes are drawn for: standard for shifted tunings. */
export const shapeStrings = (t: Tuning) => t.strings.map((s) => s + t.shift)

/** Whether shapes are drawn for the instrument's standard tuning (so the box needn't name the strings). */
export const isStandardShapes = (t: Tuning) => {
  const standard = TUNINGS.find((s) => s.instrument === t.instrument)!.strings
  const shapes = shapeStrings(t)
  return shapes.length === standard.length && shapes.every((s, i) => s === standard[i])
}

/** Which instrument a set of open strings belongs to (for code that only has the strings). */
export function instrumentFor(strings: number[]): Instrument {
  if (Math.max(...strings) < 48) return 'bass'
  if (strings.length === 4) return 'ukulele'
  return 'guitar'
}

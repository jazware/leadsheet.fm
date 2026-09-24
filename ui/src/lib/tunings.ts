// Ids match the fm.leadsheet.sheet `tuning` knownValues.

export interface Tuning {
  id: string
  name: string
  /** Open-string MIDI pitches, low E side first. */
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

export const TUNINGS: Tuning[] = [
  { id: 'standard', name: 'Standard', strings: STANDARD_STRINGS, shift: 0 },
  { id: 'eb-standard', name: 'Half step down', strings: [39, 44, 49, 54, 58, 63], shift: 1 },
  { id: 'd-standard', name: 'Whole step down', strings: [38, 43, 48, 53, 57, 62], shift: 2 },
  { id: 'drop-d', name: 'Drop D', strings: [38, 45, 50, 55, 59, 64], shift: 0 },
  { id: 'drop-c', name: 'Drop C', strings: [36, 43, 48, 53, 57, 62], shift: 0 },
  { id: 'dadgad', name: 'DADGAD', strings: [38, 45, 50, 55, 57, 62], shift: 0 },
  { id: 'open-d', name: 'Open D', strings: [38, 45, 50, 54, 57, 62], shift: 0 },
  { id: 'open-g', name: 'Open G', strings: [38, 43, 50, 55, 59, 62], shift: 0 },
  { id: 'open-e', name: 'Open E', strings: [40, 47, 52, 56, 59, 64], shift: 0 },
  { id: 'open-c', name: 'Open C', strings: [36, 43, 48, 55, 60, 64], shift: 0 },
]

export function getTuning(id: string | null | undefined): Tuning {
  return TUNINGS.find((t) => t.id === id) ?? TUNINGS[0]
}

/** The strings the chord shapes are drawn for: standard for shifted tunings. */
export const shapeStrings = (t: Tuning) => t.strings.map((s) => s + t.shift)

export const isStandardShapes = (t: Tuning) =>
  shapeStrings(t).every((s, i) => s === STANDARD_STRINGS[i])

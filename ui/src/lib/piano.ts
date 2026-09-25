/**
 * Piano voicings: the bass note in the left hand (a slash chord's bass,
 * else the root) around the octave below middle C, and the chord in the
 * right hand around middle C, in root position or an inversion. Stepping
 * through a chord's "shapes" on piano steps through the inversions.
 */
import { chordTones } from '@/lib/guitar'
import { mod12, type Chord } from '@/lib/music'

export interface PianoVoicing {
  /** MIDI notes, lowest first: [left hand, ...right hand]. */
  notes: number[]
  /** 0 = root position, 1 = first inversion… */
  inversion: number
}

const LH_LOW = 36 // C2
const RH_LOW = 55 // G3: the right hand starts here or just above

export function pianoVoicings(chord: Chord): PianoVoicing[] {
  let tones = chordTones(chord)
  // Five-note chords (9ths): leave out the fifth, as pianists usually do.
  if (tones.length > 4) tones = tones.filter((_, i) => i !== 2)
  // Close position: the tones in pitch order within an octave of the root
  // (so an add9's 9th sits next to the root, not an octave up).
  tones = [...tones].sort((a, b) => mod12(a - chord.root) - mod12(b - chord.root))
  const bass = chord.bass !== undefined && chord.bass !== null ? chord.bass : chord.root
  const lh = LH_LOW + mod12(bass - LH_LOW)
  return tones.map((_, inversion) => {
    const order = [...tones.slice(inversion), ...tones.slice(0, inversion)]
    const rh: number[] = []
    let note = RH_LOW + mod12(order[0] - RH_LOW)
    for (const pc of order) {
      while (mod12(note) !== pc || (rh.length && note <= rh[rh.length - 1])) note++
      rh.push(note)
    }
    return { notes: [lh, ...rh], inversion }
  })
}

export const pianoKey = (v: PianoVoicing) => v.notes.join(',')

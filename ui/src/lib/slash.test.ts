import { describe, expect, it } from 'vitest'
import { chordTones, shapesFor } from '@/lib/guitar'
import { chordKey, sheetShapes } from '@/components/Voicings'
import { mod12, parseChord } from '@/lib/music'
import { getTuning, shapeStrings, STANDARD_STRINGS } from '@/lib/tunings'

const chord = (name: string) => {
  const c = parseChord(name)!
  return { root: c.root, quality: c.quality!, bass: c.bass }
}
const lowestNote = (frets: (number | null)[], strings: number[]) => {
  const s = frets.findIndex((f) => f !== null)
  return mod12(strings[s] + frets[s]!)
}

describe('slash chords', () => {
  it('are different chords to look shapes up by', () => {
    expect(chordKey(parseChord('Em7/D')!)).not.toBe(chordKey(parseChord('Em7/G')!))
    expect(chordKey(parseChord('Em7/D')!)).not.toBe(chordKey(parseChord('Em7')!))
    // A bass that is the root is just the chord.
    expect(chordKey(parseChord('C/C')!)).toBe(chordKey(parseChord('C')!))
    const own = sheetShapes([
      { chord: 'Em7/D', frets: [-1, -1, 0, 0, 3, 3] },
      { chord: 'Em7/G', frets: [3, 2, 0, 0, 3, 3] },
    ])
    expect(own.size).toBe(2)
  })

  it('put their bass note lowest on guitar', () => {
    for (const name of ['Em7/D', 'Em7/G', 'C/G', 'D/F#', 'G/B', 'Am/E']) {
      const c = chord(name)
      const shapes = shapesFor(c, STANDARD_STRINGS)
      expect(shapes.length).toBeGreaterThan(0)
      const tones = new Set([...chordTones(c), c.bass!])
      for (const v of shapes) {
        expect(lowestNote(v.frets, STANDARD_STRINGS)).toBe(c.bass)
        v.frets.forEach((f, s) => f !== null && expect(tones.has(mod12(STANDARD_STRINGS[s] + f))).toBe(true))
      }
    }
    expect(shapesFor(chord('Em7/D'), STANDARD_STRINGS)[0]).not.toEqual(shapesFor(chord('Em7/G'), STANDARD_STRINGS)[0])
  })

  it('are the bass note and its octave on bass', () => {
    const strings = shapeStrings(getTuning('standard', 'bass'))
    const v = shapesFor(chord('C/G'), strings)[0]
    const notes = v.frets.flatMap((f, s) => (f === null ? [] : [strings[s] + f]))
    expect(notes.length).toBe(2)
    expect(mod12(notes[0])).toBe(7)
    expect(notes[1] - notes[0]).toBe(12)
  })

  it('are just the chord on ukulele', () => {
    const uke = shapeStrings(getTuning('standard', 'ukulele'))
    expect(shapesFor(chord('C/G'), uke)[0].frets).toEqual([0, 0, 0, 3])
  })
})

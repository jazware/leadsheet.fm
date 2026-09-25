import { describe, expect, it } from 'vitest'
import { chordTones, shapesFor, voicings } from '@/lib/guitar'
import { mod12, parseChord, type Chord } from '@/lib/music'
import { getTuning, shapeStrings } from '@/lib/tunings'

const chord = (name: string): Chord => {
  const c = parseChord(name)!
  return { root: c.root, quality: c.quality! }
}
const frets = (v: { frets: (number | null)[] } | undefined) => v?.frets.map((f) => (f === null ? 'x' : f)).join('')

describe('ukulele', () => {
  const uke = shapeStrings(getTuning('standard', 'ukulele'))
  // The shapes every ukulele chart shows.
  const known: [string, string][] = [
    ['C', '0003'], ['G', '0232'], ['Am', '2000'], ['F', '2010'], ['D', '2220'], ['Em', '0432'],
    ['A', '2100'], ['Dm', '2210'], ['C7', '0001'], ['G7', '0212'], ['A7', '0100'], ['Bb', '3211'],
    ['E', '4442'], ['Bm', '4222'], ['B', '4322'], ['D7', '2223'],
  ]
  for (const [name, shape] of known) {
    it(`${name} is ${shape}`, () => expect(frets(voicings(chord(name), uke)[0])).toBe(shape))
  }

  it('offers more shapes, all the chord, all four strings', () => {
    for (const name of ['C', 'G', 'Am', 'E', 'Bm']) {
      const shapes = shapesFor(chord(name), uke)
      expect(shapes.length).toBeGreaterThan(1)
      const tones = new Set(chordTones(chord(name)))
      for (const v of shapes) {
        expect(v.frets.every((f) => f !== null)).toBe(true)
        for (let s = 0; s < 4; s++) expect(tones.has(mod12(uke[s] + v.frets[s]!))).toBe(true)
      }
    }
  })
})

describe('bass', () => {
  for (const id of ['standard', 'drop-d', 'five-string']) {
    const strings = shapeStrings(getTuning(id, 'bass'))
    it(`root, fifth, octave in ${id}`, () => {
      for (const name of ['E', 'A', 'C', 'F#m', 'Bb', 'Bdim']) {
        const c = chord(name)
        const shapes = shapesFor(c, strings)
        expect(shapes.length).toBeGreaterThan(0)
        const fifth = c.quality === 'dim' ? 6 : 7
        for (const v of shapes) {
          const notes = v.frets.flatMap((f, s) => (f === null ? [] : [strings[s] + f]))
          expect(notes.length).toBe(3)
          expect([notes[1] - notes[0], notes[2] - notes[0]]).toEqual([fifth, 12])
          expect(mod12(notes[0])).toBe(c.root)
        }
      }
    })
  }

  it('starts low on the neck', () => {
    const strings = shapeStrings(getTuning('standard', 'bass'))
    expect(frets(shapesFor(chord('A'), strings)[0])).toBe('x022') // the open A string
  })
})

describe('tunings', () => {
  it('each instrument has its own standard', () => {
    expect(getTuning('', 'ukulele').strings).toEqual([67, 60, 64, 69])
    expect(getTuning('standard', 'bass').strings).toEqual([28, 33, 38, 43])
    expect(getTuning('open-g', 'bass').id).toBe('standard') // not a bass tuning
    expect(getTuning('drop-d', 'chords').strings[0]).toBe(38)
  })
})

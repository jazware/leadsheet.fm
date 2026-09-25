import { describe, expect, it } from 'vitest'
import { pianoVoicings } from '@/lib/piano'
import { mod12, parseChord } from '@/lib/music'
import { chordTones } from '@/lib/guitar'

const chord = (name: string) => {
  const c = parseChord(name)!
  return { root: c.root, quality: c.quality!, bass: c.bass }
}

describe('pianoVoicings', () => {
  it('plays C as C in the left hand and C E G, then inversions', () => {
    const v = pianoVoicings(chord('C'))
    expect(v.map((x) => x.notes)).toEqual([
      [36, 60, 64, 67],
      [36, 64, 67, 72],
      [36, 55, 60, 64],
    ])
  })

  it('puts a slash chord’s bass in the left hand', () => {
    expect(mod12(pianoVoicings(chord('C/G'))[0].notes[0])).toBe(7)
    expect(mod12(pianoVoicings(chord('D/F#'))[0].notes[0])).toBe(6)
  })

  it('always plays every chord tone, ascending, in a playable spot', () => {
    for (const name of ['Am', 'F#m7', 'Bb', 'Ebmaj7', 'G7', 'Bdim', 'Csus4', 'Dadd9']) {
      const c = chord(name)
      for (const { notes } of pianoVoicings(c)) {
        const [lh, ...rh] = notes
        expect(lh).toBeGreaterThanOrEqual(36)
        expect(lh).toBeLessThan(48)
        expect(rh[0]).toBeGreaterThanOrEqual(55)
        expect(rh.at(-1)!).toBeLessThan(80)
        rh.slice(1).forEach((n, i) => expect(n).toBeGreaterThan(rh[i]))
        expect(new Set(rh.map(mod12))).toEqual(new Set(chordTones(c)))
      }
    }
  })
})

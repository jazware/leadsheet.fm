import { describe, expect, it } from 'vitest'
import { chordTones, shapesFor, voicings } from '@/lib/guitar'
import { mod12, type Quality } from '@/lib/music'
import { STANDARD_STRINGS } from '@/lib/tunings'

const OPEN_D = [38, 45, 50, 54, 57, 62]

describe('shapesFor', () => {
  const cases: [number, Quality][] = [[0, 'maj'], [9, 'min'], [2, 'maj7'], [7, '7'], [4, 'sus4'], [11, 'hdim7']]
  for (const strings of [STANDARD_STRINGS, OPEN_D]) {
    for (const [root, quality] of cases) {
      it(`${root}:${quality} on ${strings.join(',')}`, () => {
        const shapes = shapesFor({ root, quality }, strings)
        // The default shape stays first, so nothing changes until you cycle.
        expect(shapes[0]).toEqual(voicings({ root, quality }, strings)[0])
        expect(shapes.length).toBeGreaterThan(1)
        expect(shapes.length).toBeLessThanOrEqual(8)
        // All different, and all actually this chord with the root in the bass.
        expect(new Set(shapes.map((v) => v.frets.join(','))).size).toBe(shapes.length)
        const tones = new Set(chordTones({ root, quality }))
        for (const v of shapes) {
          const sounding = v.frets.flatMap((f, s) => (f === null ? [] : [mod12(strings[s] + f)]))
          expect(sounding[0]).toBe(root)
          for (const pc of sounding) expect(tones.has(pc)).toBe(true)
        }
      })
    }
  }
})

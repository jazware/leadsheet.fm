import { describe, expect, it } from 'vitest'
import { defaultIndex, shapesList } from '@/components/Voicings'
import { fretsKey, shapesFor, type Frets } from '@/lib/guitar'
import { parseChord } from '@/lib/music'
import { STANDARD_STRINGS } from '@/lib/tunings'

describe('stepping through shapes', () => {
  for (const name of ['C', 'Am/E', 'G/B', 'F']) {
    it(`keeps ${name}'s order and counts one at a time, as the editor sets each`, () => {
      const chord = parseChord(name)!
      const generated = shapesFor({ root: chord.root, quality: chord.quality!, bass: chord.bass }, STANDARD_STRINGS)
      let own: Frets | undefined
      let list = shapesList(chord, STANDARD_STRINGS, own)
      let index = defaultIndex(list, own)
      const order = list.map((v) => fretsKey(v.frets))
      for (let step = 1; step <= list.length * 2; step++) {
        const next = list[(index + 1) % list.length]
        // What the editor does: store the shape, or nothing for the default.
        own = fretsKey(next.frets) === fretsKey(generated[0].frets) ? undefined : next.frets
        list = shapesList(chord, STANDARD_STRINGS, own)
        const now = defaultIndex(list, own)
        expect(list.map((v) => fretsKey(v.frets))).toEqual(order)
        expect(now).toBe((index + 1) % list.length)
        index = now
      }
    })
  }

  it('puts a typed shape that isn’t one of ours first', () => {
    const chord = parseChord('C')!
    const own: Frets = [8, 10, 10, 9, 8, 8]
    const list = shapesList(chord, STANDARD_STRINGS, [null, 3, 2, 0, 1, 1])
    expect(fretsKey(list[0].frets)).toBe('x,3,2,0,1,1')
    expect(defaultIndex(list, [null, 3, 2, 0, 1, 1])).toBe(0)
    // One of ours stays where it is.
    const ours = shapesList(chord, STANDARD_STRINGS, own)
    expect(defaultIndex(ours, own)).toBeGreaterThan(0)
  })
})

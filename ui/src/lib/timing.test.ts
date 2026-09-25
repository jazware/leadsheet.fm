import { describe, expect, it } from 'vitest'
import { chordBeats, syllables } from '@/lib/timing'
import { parseChordPro } from '@/lib/chordpro'

describe('syllables', () => {
  it('counts roughly right', () => {
    const near = (text: string, n: number) => expect(Math.abs(syllables(text) - n)).toBeLessThanOrEqual(1)
    near('Love of mine', 3)
    near('someday you will die', 5)
    near('illuminate the vacancy signs', 10)
    near('little table', 4)
    expect(syllables('   ')).toBe(0)
    expect(syllables('d')).toBe(0) // a word's first letter, before a chord
  })
})

describe('chordBeats', () => {
  it('holds chords over line breaks and hurries the quick changes', () => {
    const doc = parseChordPro(`[C/G]Love of mine
someday [Am/E]you will die,
but I'll be [F]close behind;
I'll follow y[C]ou into the d[G]ark.`)
    const [cg, ame, f, c, g] = chordBeats(doc)
    // The long chords are longer than the quick C, G at the end.
    expect(Math.min(cg, ame, f)).toBeGreaterThan(Math.max(c, g))
    expect(c).toBe(2)
    expect(g).toBe(2)
  })

  it('gives chords on their own line a bar each', () => {
    expect(chordBeats(parseChordPro(`[Am]    [C]   [F]   [C]`))).toEqual([4, 4, 4, 4])
  })

  it('keeps every chord between half a bar and two bars', () => {
    const doc = parseChordPro(`[C]a [G]b\n[F]${'la '.repeat(40)}`)
    for (const b of chordBeats(doc)) {
      expect(b).toBeGreaterThanOrEqual(2)
      expect(b).toBeLessThanOrEqual(8)
      expect(b % 2).toBe(0)
    }
  })
})

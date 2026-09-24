import { describe, expect, it } from 'vitest'
import { fretsText, parseFrets, voicingFromFrets } from '@/lib/guitar'
import { chordKey, sheetShapes } from '@/components/Voicings'
import { parseChord } from '@/lib/music'

describe('sheet voicings', () => {
  it('parses frets the ways players write them', () => {
    expect(parseFrets('x32010', 6)).toEqual([null, 3, 2, 0, 1, 0])
    expect(parseFrets('x 3 2 0 1 0', 6)).toEqual([null, 3, 2, 0, 1, 0])
    expect(parseFrets('8,10,10,9,8,8', 6)).toEqual([8, 10, 10, 9, 8, 8])
    expect(parseFrets('-1 3 2 0 1 0', 6)).toEqual([null, 3, 2, 0, 1, 0])
    for (const bad of ['x3201', 'x320100', 'x3201q', '8101098 8', 'xxxxxx', '']) expect(parseFrets(bad, 6)).toBeNull()
    expect(fretsText([8, 10, 10, 9, 8, 8])).toBe('8 10 10 9 8 8')
    expect(fretsText([null, 3, 2, 0, 1, 0])).toBe('x32010')
  })

  it('works out barres for typed shapes', () => {
    expect(voicingFromFrets([1, 3, 3, 2, 1, 1]).barre).toEqual({ fret: 1, from: 0, to: 5 })
    expect(voicingFromFrets([null, 3, 2, 0, 1, 0]).barre).toBeUndefined()
    expect(voicingFromFrets([null, 3, 2, 0, 1, 0]).open).toBe(true)
  })

  it('looks shapes up by chord, whatever the spelling', () => {
    const own = sheetShapes([
      { chord: 'Bb', frets: [-1, 1, 3, 3, 3, 1] },
      { chord: 'A#', frets: [6, 8, 8, 7, 6, 6] }, // same chord again: the first wins
      { chord: 'Cadd11', frets: [-1, 3, 2, 0, 1, 1] }, // a suffix we have no shapes for
    ])
    expect(own.get(chordKey(parseChord('A#')!))).toEqual([null, 1, 3, 3, 3, 1])
    expect(own.get(chordKey(parseChord('Cadd11')!))).toEqual([null, 3, 2, 0, 1, 1])
    expect(own.size).toBe(2)
  })
})

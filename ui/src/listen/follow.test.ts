import { describe, expect, it } from 'vitest'
import { Follower, type SheetChord } from './follow'
import { btcClass, N_CHORDS, NO_CHORD } from './btc'
import { mod12, type Quality } from '@/lib/music'

const C = (root: number, quality: Quality): SheetChord => ({ root, quality })
// Verse: C G Am F, twice; chorus: F G C C (the repeated C is written twice).
const SHEET = [C(0, 'maj'), C(7, 'maj'), C(9, 'min'), C(5, 'maj'), C(0, 'maj'), C(7, 'maj'), C(9, 'min'), C(5, 'maj'), C(5, 'maj'), C(7, 'maj'), C(0, 'maj'), C(0, 'maj')]

/** BTC-ish output for a chord: most mass on it, the rest spread thin. */
function frame(root: number, quality: Quality, sure = 0.7): Float32Array {
  const p = new Float32Array(N_CHORDS).fill((1 - sure) / N_CHORDS)
  p[btcClass(mod12(root), quality)!] += sure
  return p
}
const silence = () => {
  const p = new Float32Array(N_CHORDS).fill(0.1 / N_CHORDS)
  p[NO_CHORD] += 0.9
  return p
}

/** Play chords for `frames` frames each; returns where the marker was halfway through each. */
function play(f: Follower, chords: SheetChord[], frames = 20, transpose = 0) {
  return chords.map((c) => {
    let mid = f.step(frame(c.root + transpose, c.quality!))
    for (let i = 1; i < frames; i++) {
      const pos = f.step(frame(c.root + transpose, c.quality!))
      if (i === frames >> 1) mid = pos
    }
    return mid
  })
}

describe('Follower', () => {
  it('follows the chords in order', () => {
    const f = new Follower(SHEET, [{ offset: 0, weight: 1 }])
    const shown = play(f, SHEET.slice(0, 8)).map((p) => p.index)
    expect(shown).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('works out a transposition the page did not say', () => {
    const f = new Follower(SHEET, [{ offset: 0, weight: 1 }])
    const pos = play(f, SHEET.slice(0, 6), 20, 2) // capo 2, sheet in shapes
    expect(pos.map((p) => p.index)).toEqual([0, 1, 2, 3, 4, 5])
    expect(pos.at(-1)!.offset).toBe(2)
  })

  it('finds the chorus when the player jumps to it', () => {
    const f = new Follower(SHEET, [{ offset: 0, weight: 1 }], [0, 8])
    play(f, SHEET.slice(0, 4))
    // Straight to the chorus: F G C C. "F G C" alone could be verse 2
    // skipping its C, so it takes the held C to be sure.
    const shown = play(f, [C(5, 'maj'), C(7, 'maj'), C(0, 'maj'), C(0, 'maj')], 30).map((p) => p.index)
    expect(shown.at(-1)).toBe(11)
  })

  it('holds still through silence', () => {
    const f = new Follower(SHEET, [{ offset: 0, weight: 1 }])
    play(f, SHEET.slice(0, 3))
    let pos = f.step(silence())
    for (let i = 0; i < 100; i++) pos = f.step(silence())
    expect(pos.silent).toBe(true)
    expect(pos.index).toBe(2)
    expect(play(f, [SHEET[3]]).at(-1)!.index).toBe(3)
  })

  it('moves through a repeated chord on time', () => {
    const f = new Follower(SHEET, [{ offset: 0, weight: 1 }])
    play(f, SHEET.slice(0, 10))
    // C C at the end of the chorus: the marker should reach the second C
    // after holding C for about two chords' worth.
    const held = play(f, [C(0, 'maj'), C(0, 'maj')])
    expect(held[0].index).toBe(10)
    expect(held[1].index).toBe(11)
  })
})

describe('Follower with extensions', () => {
  it('moves between D and Dmaj7 even when only D is heard', () => {
    const sheet = [C(2, 'maj'), C(2, 'maj7'), C(2, 'maj'), C(7, 'maj'), C(2, 'maj'), C(2, 'maj7'), C(4, 'maj')]
    const f = new Follower(sheet, [{ offset: 0, weight: 1 }])
    // BTC calls every D-ish chord plain D.
    const heard = [C(2, 'maj'), C(2, 'maj'), C(2, 'maj'), C(7, 'maj'), C(2, 'maj'), C(2, 'maj'), C(4, 'maj')]
    const shown = play(f, heard, 24).map((p) => p.index)
    // Pace carries it through the D-Dmaj7-D stretch; G and E pin it down.
    expect(shown[3]).toBe(3)
    expect(shown[6]).toBe(6)
    expect(shown.slice(4, 6)).toEqual([4, 5])
  })
})

describe('Follower and far jumps', () => {
  // Verse 1, verse 2, chorus, twice, then a bridge far down that starts Bm E.
  const VERSE = [C(7, 'maj'), C(2, 'maj'), C(4, 'min'), C(0, 'maj')]
  const CHORUS = [C(0, 'maj'), C(7, 'maj'), C(9, 'min'), C(5, 'maj')]
  const BRIDGE = [C(11, 'min'), C(4, 'maj'), C(9, 'maj'), C(2, 'maj')]
  const SONG = [...VERSE, ...VERSE, ...CHORUS, ...VERSE, ...VERSE, ...CHORUS, ...BRIDGE]
  const SECTIONS = [0, 4, 8, 12, 16, 20, 24]

  it.each([6, 12])("doesn't leap down the page on misheard chords (%i frames each)", (frames) => {
    const f = new Follower(SONG, [{ offset: 0, weight: 1 }], SECTIONS)
    play(f, VERSE)
    // A messy moment: what BTC hears looks like the bridge's Bm E.
    const shown: number[] = []
    for (const c of [C(11, 'min'), C(4, 'maj')]) for (let i = 0; i < frames; i++) shown.push(f.step(frame(c.root, c.quality!)).index)
    // ...then the player carries on into verse 2.
    shown.push(...play(f, VERSE).map((p) => p.index))
    expect(Math.max(...shown)).toBeLessThan(8)
    expect(shown.slice(-4)).toEqual([4, 5, 6, 7])
  })

  it('follows a jump to a chorus within a phrase', () => {
    const f = new Follower(SONG, [{ offset: 0, weight: 1 }], SECTIONS)
    play(f, [...VERSE, ...VERSE, ...CHORUS, ...VERSE])
    // A chorus instead of verse 4: by its last chord the marker is on
    // that chord in one of the choruses (which one can't be told apart).
    const shown = play(f, CHORUS).map((p) => p.index)
    expect([11, 23]).toContain(shown.at(-1))
  })

  it('gets to a far section eventually when it really is being played', () => {
    const f = new Follower(SONG, [{ offset: 0, weight: 1 }], SECTIONS)
    play(f, VERSE)
    // Straight from verse 1 into the bridge, and round it again.
    const shown = play(f, [...BRIDGE, ...BRIDGE], 20).map((p) => p.index)
    expect(shown.slice(-3)).toEqual([25, 26, 27])
  })
})

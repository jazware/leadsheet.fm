import { describe, expect, it } from 'vitest'
import { chordPitches, pluckSamples } from '@/lib/pluck'
import { STANDARD_STRINGS, getTuning } from '@/lib/tunings'

/** Fundamental by autocorrelation over the first half second. */
function pitchOf(x: Float32Array, sr: number, lo = 60, hi = 1200): number {
  const seg = x.subarray(Math.floor(sr * 0.05), Math.floor(sr * 0.55))
  let best = 0
  let bestLag = 0
  const corr = (lag: number) => {
    let s = 0
    for (let i = 0; i + lag < seg.length; i++) s += seg[i] * seg[i + lag]
    return s
  }
  for (let lag = Math.floor(sr / hi); lag <= Math.ceil(sr / lo); lag++) {
    const c = corr(lag)
    if (c > best) {
      best = c
      bestLag = lag
    }
  }
  // Parabolic interpolation around the peak for sub-sample accuracy.
  const a = corr(bestLag - 1)
  const b = corr(bestLag)
  const c = corr(bestLag + 1)
  return sr / (bestLag + (0.5 * (a - c)) / (a - 2 * b + c))
}

const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length)

describe('pluckSamples', () => {
  for (const freq of [82.41, 146.83, 246.94, 329.63, 659.26]) {
    it(`sounds at ${freq} Hz and dies away`, () => {
      const sr = 48000
      const x = pluckSamples(freq, sr)
      const cents = 1200 * Math.log2(pitchOf(x, sr) / freq)
      expect(Math.abs(cents)).toBeLessThan(3)
      expect(rms(x.subarray(sr * 2.5, sr * 3))).toBeLessThan(rms(x.subarray(0, sr / 2)) / 3)
      expect(x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)).toBeLessThan(1)
    })
  }

  it('is the same every time', () => {
    expect(pluckSamples(220, 44100, 0.5, 7)).toEqual(pluckSamples(220, 44100, 0.5, 7))
  })
})

describe('chordPitches', () => {
  it('adds the capo and leaves muted strings out', () => {
    expect(chordPitches([null, 3, 2, 0, 1, 0], STANDARD_STRINGS)).toEqual([48, 52, 55, 60, 64])
    expect(chordPitches([null, 3, 2, 0, 1, 0], STANDARD_STRINGS, 2)).toEqual([50, 54, 57, 62, 66])
  })

  it('sounds a half-step-down chart a half step down', () => {
    // Drawn with standard shapes, played on strings tuned down.
    expect(chordPitches([null, 3, 2, 0, 1, 0], getTuning('eb-standard').strings)).toEqual([47, 51, 54, 59, 63])
  })
})

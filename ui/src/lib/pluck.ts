/**
 * Plucked-string synthesis (Karplus-Strong) so a chord can be heard, not
 * just seen. A burst of filtered noise circulates in a delay line one
 * period long; averaging neighbouring samples on every pass loses the
 * highs first, which is what a plucked string does.
 */
import type { Frets } from '@/lib/guitar'

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12)

/**
 * One plucked note, as samples. Deterministic (seeded noise), so every
 * pluck of a note sounds the same and tests can check it.
 */
export function pluckSamples(freq: number, sampleRate: number, seconds = 3.5, seed = 1): Float32Array {
  const n = Math.floor(sampleRate * seconds)
  const out = new Float32Array(n)
  // Each pass averages the samples `len` and `len - 1` behind, a delay of
  // len - 0.5; the allpass makes up the fractional rest (kept in
  // 0.1..1.1, where it's well behaved) so high notes are in tune too.
  const period = sampleRate / freq
  const len = Math.max(2, Math.floor(period + 0.4))
  const frac = period + 0.5 - len
  const c = (1 - frac) / (1 + frac)
  // Low strings ring longer: roughly 7 s at 80 Hz, 2.5 s at 660 Hz.
  const t60 = Math.min(8, Math.max(1.5, 7 * Math.sqrt(80 / freq)))
  const loss = 10 ** ((-3 * period) / (sampleRate * t60))

  // Excitation: noise, softened (a pick, not a razor), minus a copy a
  // little way along (plucking an eighth of the way from the bridge).
  let s = seed >>> 0 || 1
  const noise = () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 0xffffffff - 0.5
  }
  const line = new Float32Array(len)
  let lp = 0
  for (let i = 0; i < len; i++) {
    lp += 0.5 * (noise() - lp)
    line[i] = lp
  }
  const at = Math.max(1, Math.round(len / 8))
  const excited = line.map((v, i) => v - (i >= at ? line[i - at] : 0))
  const mean = excited.reduce((a, b) => a + b, 0) / len
  for (let i = 0; i < len; i++) line[i] = excited[i] - mean

  let idx = 0
  let prev = 0 // allpass state
  let prevIn = 0
  for (let i = 0; i < n; i++) {
    const a = line[idx]
    const b = line[(idx + 1) % len]
    const avg = loss * 0.5 * (a + b)
    // First-order allpass for the fractional part of the period.
    const y = c * avg + prevIn - c * prev
    prevIn = avg
    prev = y
    line[idx] = y
    out[i] = a
    idx = (idx + 1) % len
  }
  // Fade the tail so a long note doesn't click off.
  const fade = Math.min(n, Math.floor(sampleRate * 0.08))
  for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade
  return out
}

/** Sounding MIDI pitches of a shape: open strings + fret + capo, muted strings left out. */
export function chordPitches(frets: Frets, openStrings: number[], capo = 0): number[] {
  return frets.flatMap((f, i) => (f === null ? [] : [openStrings[i] + f + capo]))
}

let ctx: AudioContext | null = null
let out: AudioNode | null = null
const buffers = new Map<number, AudioBuffer>()

/** The shared audio graph: a touch of body resonance and a limiter. */
function audio(): { ctx: AudioContext; out: AudioNode } {
  if (!ctx || !out) {
    ctx = new AudioContext()
    const body = ctx.createBiquadFilter()
    body.type = 'peaking'
    body.frequency.value = 180
    body.Q.value = 1.2
    body.gain.value = 4
    const tone = ctx.createBiquadFilter()
    tone.type = 'lowpass'
    tone.frequency.value = 6000
    const limit = ctx.createDynamicsCompressor()
    limit.threshold.value = -10
    limit.ratio.value = 8
    body.connect(tone).connect(limit).connect(ctx.destination)
    out = body
  }
  return { ctx, out }
}

function note(midi: number): AudioBuffer {
  const { ctx } = audio()
  let buf = buffers.get(midi)
  if (!buf) {
    const samples = pluckSamples(midiHz(midi), ctx.sampleRate, 3.5, midi)
    buf = ctx.createBuffer(1, samples.length, ctx.sampleRate)
    buf.getChannelData(0).set(samples)
    buffers.set(midi, buf)
  }
  return buf
}

/** Whether the reader has played something yet (so the browser allows sound). */
export const audioStarted = () => ctx !== null

let playing: GainNode[] = []

/**
 * Strums a chord shape, low string to high, like a relaxed downstroke.
 * Anything still ringing is damped first, as a hand would.
 */
export function strum(frets: Frets, openStrings: number[], capo = 0) {
  const pitches = chordPitches(frets, openStrings, capo)
  if (!pitches.length) return
  const { ctx, out } = audio()
  void ctx.resume()
  const now = ctx.currentTime + 0.02
  for (const g of playing) {
    g.gain.cancelScheduledValues(now)
    g.gain.setTargetAtTime(0, now, 0.03)
  }
  playing = []
  const level = 0.9 / Math.sqrt(pitches.length)
  pitches.forEach((midi, i) => {
    const src = ctx.createBufferSource()
    src.buffer = note(midi)
    const gain = ctx.createGain()
    gain.gain.value = level * (1 - i * 0.04)
    src.connect(gain).connect(out)
    src.start(now + i * 0.028)
    playing.push(gain)
  })
}

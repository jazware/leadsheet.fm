/**
 * Plucked-string synthesis (Karplus-Strong) so a chord can be heard, not
 * just seen. A burst of filtered noise circulates in a delay line one
 * period long; averaging neighbouring samples on every pass loses the
 * highs first, which is what a plucked string does.
 */
import type { Frets } from '@/lib/guitar'
import type { Instrument } from '@/lib/tunings'

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12)

/**
 * One plucked note, as samples. Deterministic (seeded noise), so every
 * pluck of a note sounds the same and tests can check it.
 */
export function pluckSamples(freq: number, sampleRate: number, seconds = 3.5, seed = 1, bright = 0.5): Float32Array {
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

  // Excitation: noise, softened (a pick, not a razor; nylon or a thumb is
  // softer still: `bright` lower), minus a copy a
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
    lp += bright * (noise() - lp)
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
const buffers = new Map<string, AudioBuffer>()

// How bright each instrument's pluck is: steel strings with a pick, nylon
// ukulele strings, a bass plucked with fingers.
const BRIGHT: Record<Instrument, number> = { guitar: 0.5, ukulele: 0.28, bass: 0.22 }

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

function note(midi: number, instrument: Instrument): AudioBuffer {
  const { ctx } = audio()
  let buf = buffers.get(`${instrument}:${midi}`)
  if (!buf) {
    const samples = pluckSamples(midiHz(midi), ctx.sampleRate, 3.5, midi, BRIGHT[instrument])
    buf = ctx.createBuffer(1, samples.length, ctx.sampleRate)
    buf.getChannelData(0).set(samples)
    buffers.set(`${instrument}:${midi}`, buf)
  }
  return buf
}

/** Whether the reader has played something yet (so the browser allows sound). */
export const audioStarted = () => ctx !== null

// What's sounding (to damp at the next strum) and what's queued (to cancel).
let ringing: GainNode[] = []
let queued: AudioBufferSourceNode[] = []

/**
 * Strums a shape at audio time `when`: a downstroke low string to high,
 * or a lighter upstroke across the top four strings. Whatever was ringing
 * is damped at that moment, as the strumming hand would.
 */
function strumAt(
  frets: Frets,
  openStrings: number[],
  capo: number,
  instrument: Instrument,
  when: number,
  up = false,
  level = 1,
  only?: number,
) {
  const { ctx, out } = audio()
  let pitches = chordPitches(frets, openStrings, capo)
  if (only !== undefined) pitches = pitches.slice(only, only + 1)
  else if (up) pitches = pitches.slice(-4).reverse()
  if (!pitches.length) return
  for (const g of ringing) g.gain.setTargetAtTime(0, when, 0.025)
  ringing = []
  const base = (0.9 / Math.sqrt(pitches.length)) * level
  const gap = up ? 0.014 : 0.028
  pitches.forEach((midi, i) => {
    const src = ctx.createBufferSource()
    src.buffer = note(midi, instrument)
    const gain = ctx.createGain()
    gain.gain.value = base * (1 - i * 0.04)
    src.connect(gain).connect(out)
    src.start(when + i * gap)
    src.onended = () => (queued = queued.filter((q) => q !== src))
    ringing.push(gain)
    queued.push(src)
  })
}

/** Strums a chord shape now (a bass shape is played as a quick arpeggio). */
export function strum(frets: Frets, openStrings: number[], capo = 0, instrument: Instrument = 'guitar') {
  const { ctx } = audio()
  void ctx.resume()
  const now = ctx.currentTime + 0.02
  if (instrument === 'bass') {
    chordPitches(frets, openStrings, capo).forEach((_, i) => strumAt(frets, openStrings, capo, instrument, now + i * 0.18, false, 1, i))
  } else strumAt(frets, openStrings, capo, instrument, now)
}

/** Silences everything, including strums queued for later. */
export function hush() {
  if (!ctx) return
  const now = ctx.currentTime
  for (const src of queued) {
    try {
      src.stop(now + 0.05)
    } catch {
      // never started
    }
  }
  for (const g of ringing) g.gain.setTargetAtTime(0, now, 0.02)
  queued = []
  ringing = []
}

// One bar of "down, down-up, up-down-up" in eighths: [beat, upstroke, level].
const STRUM: [number, boolean, number][] = [
  [0, false, 1],
  [1, false, 0.7],
  [1.5, true, 0.5],
  [2.5, true, 0.5],
  [3, false, 0.75],
  [3.5, true, 0.5],
]
// A bass bar: root, root-root, fifth, octave: [beat, note of the shape (0 root, 1 fifth, 2 octave), level].
const BASS_LINE: [number, number, number][] = [
  [0, 0, 1],
  [1, 0, 0.8],
  [1.5, 0, 0.6],
  [2, 1, 0.8],
  [3, 2, 0.75],
]
export const BEATS_PER_CHORD = 4

/**
 * Plays a chart: each chord a bar of the strum pattern at `bpm`, starting
 * from chord `from`. Strums are queued on the audio clock a little ahead,
 * so timing holds when the page is busy. `onChord` fires as each chord
 * starts sounding and `onEnd` after the last; the returned function stops.
 */
export function playThrough(
  chords: (Frets | null)[],
  openStrings: number[],
  capo: number,
  bpm: number,
  onChord: (index: number) => void,
  onEnd: () => void,
  from = 0,
  instrument: Instrument = 'guitar',
): () => void {
  const { ctx } = audio()
  void ctx.resume()
  const beat = 60 / bpm
  const bar = BEATS_PER_CHORD * beat
  const start = ctx.currentTime + 0.1
  const timers: ReturnType<typeof setTimeout>[] = []
  let next = from
  const at = (i: number) => start + (i - from) * bar
  const tick = () => {
    while (next < chords.length && at(next) < ctx.currentTime + 0.5) {
      const i = next++
      const frets = chords[i]
      if (frets && instrument === 'bass') {
        for (const [b, n, level] of BASS_LINE) strumAt(frets, openStrings, capo, instrument, at(i) + b * beat, false, level, n)
      } else if (frets) {
        for (const [b, up, level] of STRUM) strumAt(frets, openStrings, capo, instrument, at(i) + b * beat, up, level)
      }
      timers.push(setTimeout(() => onChord(i), Math.max(0, (at(i) - ctx.currentTime) * 1000)))
    }
    if (next >= chords.length && ctx.currentTime > at(chords.length) - 0.05) {
      // Done: let the last chord ring out.
      clearInterval(interval)
      onEnd()
    }
  }
  const interval = setInterval(tick, 100)
  tick()
  const stop = () => {
    clearInterval(interval)
    timers.forEach(clearTimeout)
    hush()
  }
  return stop
}

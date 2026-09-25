/**
 * Chord probabilities from a growing microphone recording. CQT frames are
 * computed as soon as their filters have enough audio; BTC reruns over the
 * newest 108 frames (10 s) every few frames, and each frame is reported
 * once it has LAG frames of right context.
 */
import { cqtFrame, cqtReach, HOP, SR } from './cqt'
import { btcProbs, N_CHORDS, TIMESTEP, type BTC } from './btc'

const LAG = 3 // frames of right context (~0.28 s)
const EVERY = 3 // run BTC every this many new frames (~0.28 s)
const KEEP = SR * 20 // samples of history kept

export interface Frame {
  index: number
  /** Seconds from the start of listening. */
  time: number
  probs: Float32Array
  /** Seconds between this frame's centre and the newest audio. */
  delay: number
  /** How loud the microphone is, before leveling (dBFS, RMS over a few seconds). */
  level: number
}

// Input leveling. BTC learned from mastered recordings, and its features
// are log-magnitudes, so a quiet microphone (a guitar across the room,
// with the browser's own gain control off for fidelity) reads to it as
// near-silence and it hears no chord at all. So the input is brought up to
// recording level: slowly (a few seconds), so it doesn't pump; by at most
// MAX_GAIN; and not at all below NOISE_FLOOR, so a silent room stays silent.
const TARGET_RMS = 0.1
const MAX_GAIN = 1000 // +60 dB
const NOISE_FLOOR = 2e-5 // about -94 dBFS
const LEVEL_SECONDS = 3

export class Leveler {
  private meanSquare = 0
  private gain = 1

  /** The input's recent level (dBFS). */
  get level() {
    return 10 * Math.log10(this.meanSquare + 1e-12)
  }

  process(chunk: Float32Array): Float32Array {
    let sum = 0
    for (const v of chunk) sum += v * v
    const alpha = 1 - Math.exp(-chunk.length / (SR * LEVEL_SECONDS))
    this.meanSquare += alpha * (sum / chunk.length - this.meanSquare)
    const rms = Math.sqrt(this.meanSquare)
    const want = rms < NOISE_FLOOR ? 1 : Math.min(MAX_GAIN, Math.max(1, TARGET_RMS / rms))
    this.gain += 0.25 * (want - this.gain)
    const out = new Float32Array(chunk.length)
    for (let i = 0; i < chunk.length; i++) out[i] = Math.max(-1, Math.min(1, chunk[i] * this.gain))
    return out
  }
}

export class LiveChords {
  private samples = new Float32Array(KEEP * 2)
  /** Absolute index of samples[0]. */
  private offset = 0
  private length = 0
  private feats: Float32Array[] = []
  private reported = 0
  private sinceRun = 0
  private busy = false
  private leveler = new Leveler()

  constructor(
    private btc: BTC,
    private emit: (f: Frame) => void,
  ) {}

  push(raw: Float32Array) {
    const chunk = this.leveler.process(raw)
    if (this.length + chunk.length > this.samples.length) {
      // Drop old audio, keeping the last KEEP samples.
      const drop = this.length - KEEP
      this.samples.copyWithin(0, drop, this.length)
      this.offset += drop
      this.length -= drop
    }
    this.samples.set(chunk, this.length)
    this.length += chunk.length
    const reach = cqtReach()
    const y = this.samples.subarray(0, this.length)
    while (this.feats.length * HOP + reach <= this.offset + this.length) {
      this.feats.push(cqtFrame(y, this.feats.length * HOP - this.offset))
      if (this.feats.length > TIMESTEP * 2) this.feats[this.feats.length - TIMESTEP * 2 - 1] = EMPTY
      this.sinceRun++
    }
    if (this.sinceRun >= EVERY && !this.busy) void this.run()
  }

  private async run() {
    this.busy = true
    this.sinceRun = 0
    const end = this.feats.length
    const start = Math.max(0, end - TIMESTEP)
    try {
      const probs = await btcProbs(this.btc, this.feats.slice(start, end))
      const now = (this.offset + this.length) / SR
      for (; this.reported < end - LAG; this.reported++) {
        const row = this.reported - start
        if (row < 0) continue
        const time = (this.reported * HOP) / SR
        this.emit({
          index: this.reported,
          time,
          probs: probs.slice(row * N_CHORDS, (row + 1) * N_CHORDS),
          delay: now - time,
          level: this.leveler.level,
        })
      }
    } finally {
      this.busy = false
    }
  }
}

const EMPTY = new Float32Array(0)

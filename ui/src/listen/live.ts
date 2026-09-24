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

  constructor(
    private btc: BTC,
    private emit: (f: Frame) => void,
  ) {}

  push(chunk: Float32Array) {
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
        this.emit({ index: this.reported, time, probs: probs.slice(row * N_CHORDS, (row + 1) * N_CHORDS), delay: now - time })
      }
    } finally {
      this.busy = false
    }
  }
}

const EMPTY = new Float32Array(0)

/**
 * Follows a player through a sheet's chords from per-frame BTC
 * probabilities: an online HMM whose states are the chords in the order
 * they're written. Each frame the player stays on a chord, moves to the
 * next, skips one, or (rarely) jumps anywhere, for repeats and starting
 * mid-song.
 *
 * The same chord written twice in a row ("[C] ... [C]") sounds like one
 * long chord, so each run of repeats is a single state, and the marker
 * moves through a run at the pace the player has kept so far.
 *
 * Sheets are ambiguous about pitch (shapes under a capo, or the sounding
 * chords?), and players transpose, so the follower runs all twelve
 * transpositions side by side and lets the audio decide, starting from a
 * prior that favours the ones the page implies.
 */
import { simplifyQuality, mod12, type Quality } from '@/lib/music'
import { btcChord, N_CHORDS, NO_CHORD } from './btc'

export interface SheetChord {
  root: number
  quality: Quality | null
}

export interface Position {
  /** Index into the sheet's chord sequence. */
  index: number
  /** How sure the follower is of that index (posterior, 0..1). */
  confidence: number
  /** Semitones between the written chords and what's being played. */
  offset: number
  /** What's being heard, as a BTC class (or null for no chord). */
  heard: number | null
  /** True while the player seems to have stopped. */
  silent: boolean
}

const P_ADVANCE = 0.06
const P_SKIP = 0.006
const P_JUMP = 0.0015
const FLOOR = 0.03 // emission floor, so one odd frame can't wipe out a path
const SILENT = 0.5 // P(no chord) above which the clock stops

/** How well each BTC class fits a written chord (0..1). */
function template(root: number, quality: Quality | null): Float32Array {
  const t = new Float32Array(N_CHORDS)
  const want = quality && simplifyQuality(quality)
  for (let c = 0; c < N_CHORDS; c++) {
    const ch = btcChord(c)
    if (!ch || ch.root !== root) continue
    if (quality === null) t[c] = 0.7 // a suffix we can't read: the root will do
    else if (ch.quality === quality) t[c] = 1
    // BTC often hears a 7th or 6th as its triad (and vice versa), so an
    // extension barely counts against a chord: the sheet's order and the
    // player's pace decide between D and Dmaj7.
    else if (simplifyQuality(ch.quality) === want) t[c] = 0.95
    else t[c] = 0.3
  }
  return t
}

interface Run {
  /** Sheet index of the run's first chord. */
  start: number
  length: number
  kind: number
}

export class Follower {
  private readonly runs: Run[]
  /** templates[offset][kind] */
  private readonly templates: Float32Array[][]
  /** belief[offset * runs + r], sums to 1. */
  private belief: Float64Array
  private shown = 0
  private pending = -1
  private pendingFrames = 0
  /** Frames (with sound) since the marker entered its run. */
  private inRun = 0
  /** Frames per written chord, learned from the player. */
  private pace = 20

  constructor(
    sequence: SheetChord[],
    prior: { offset: number; weight: number }[],
  ) {
    const keys = new Map<string, number>()
    const kinds: SheetChord[] = []
    this.runs = []
    sequence.forEach((c, i) => {
      const k = `${mod12(c.root)}:${c.quality}`
      if (!keys.has(k)) {
        keys.set(k, kinds.length)
        kinds.push({ root: mod12(c.root), quality: c.quality })
      }
      const kind = keys.get(k)!
      const last = this.runs[this.runs.length - 1]
      if (last && last.kind === kind) last.length++
      else this.runs.push({ start: i, length: 1, kind })
    })
    this.templates = Array.from({ length: 12 }, (_, o) => kinds.map((k) => template(mod12(k.root + o), k.quality)))
    this.belief = new Float64Array(12 * this.runs.length)
    this.reset(prior)
  }

  /** Start over from the top, e.g. when the player restarts. */
  reset(prior: { offset: number; weight: number }[]) {
    const n = this.runs.length
    const offsets = new Float64Array(12).fill(0.02)
    for (const p of prior) offsets[mod12(p.offset)] += p.weight
    const total = offsets.reduce((a, b) => a + b, 0)
    for (let o = 0; o < 12; o++) {
      for (let r = 0; r < n; r++) {
        // Most likely the first chord; anywhere else is possible.
        const pos = n === 1 ? 1 : r === 0 ? 0.6 : 0.4 / (n - 1)
        this.belief[o * n + r] = (offsets[o] / total) * pos
      }
    }
    this.shown = 0
    this.pending = -1
    this.inRun = 0
  }

  /** Update with one frame of BTC probabilities. */
  step(probs: Float32Array): Position {
    const n = this.runs.length
    let heard = 0
    for (let c = 1; c < N_CHORDS; c++) if (probs[c] > probs[heard]) heard = c
    const silent = probs[NO_CHORD] > SILENT
    if (!silent && n > 0) {
      const next = new Float64Array(12 * n)
      let total = 0
      for (let o = 0; o < 12; o++) {
        const base = o * n
        let mass = 0
        for (let r = 0; r < n; r++) mass += this.belief[base + r]
        // Emissions for this transposition's distinct chords.
        const fit = this.templates[o].map((t) => {
          let s = 0
          for (let c = 0; c < N_CHORDS; c++) if (t[c]) s += t[c] * probs[c]
          return s + FLOOR
        })
        const b = this.belief
        for (let r = 0; r < n; r++) {
          // Longer runs are left less often.
          const adv = (k: number) => (P_ADVANCE / this.runs[k].length) * b[base + k]
          let p = (1 - (P_ADVANCE / this.runs[r].length) - P_SKIP - P_JUMP) * b[base + r] + (P_JUMP * mass) / n
          if (r >= 1) p += adv(r - 1)
          if (r >= 2) p += P_SKIP * b[base + r - 2]
          p *= fit[this.runs[r].kind]
          next[base + r] = p
          total += p
        }
      }
      for (let j = 0; j < next.length; j++) next[j] /= total
      this.belief = next
    }

    // Where the player is: the most likely run, all transpositions together.
    const marginal = new Float64Array(n)
    const byOffset = new Float64Array(12)
    for (let o = 0; o < 12; o++) {
      for (let r = 0; r < n; r++) {
        marginal[r] += this.belief[o * n + r]
        byOffset[o] += this.belief[o * n + r]
      }
    }
    let best = 0
    for (let r = 1; r < n; r++) if (marginal[r] > marginal[best]) best = r
    let offset = 0
    for (let o = 1; o < 12; o++) if (byOffset[o] > byOffset[offset]) offset = o

    if (!silent) this.inRun++
    // Hysteresis: move the marker once a new run has led for two frames,
    // or at once when it's confident.
    if (best !== this.shown) {
      if (best === this.pending) this.pendingFrames++
      else {
        this.pending = best
        this.pendingFrames = 1
      }
      if (this.pendingFrames >= 2 || marginal[best] > 0.6) {
        // Learn the pace from runs played through in order.
        if (best === this.shown + 1 && this.inRun > 3) {
          const perChord = this.inRun / this.runs[this.shown].length
          this.pace = Math.max(5, Math.min(60, 0.7 * this.pace + 0.3 * perChord))
        }
        this.shown = best
        this.pending = -1
        this.inRun = 0
      }
    } else {
      this.pending = -1
    }
    const run = this.runs[this.shown]
    return {
      index: run ? run.start + Math.min(run.length - 1, Math.floor(this.inRun / this.pace)) : 0,
      confidence: marginal[this.shown] ?? 0,
      offset,
      heard: heard === NO_CHORD || btcChord(heard) === null ? null : heard,
      silent,
    }
  }
}

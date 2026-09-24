/**
 * Follows a player through a sheet's chords from per-frame BTC
 * probabilities: an online HMM whose states are the chords in the order
 * they're written. Each frame the player stays on a chord, moves to the
 * next or skips one. Longer moves only go to the start of a section: back
 * (a repeated chorus, the top) or on to one of the next two, with
 * anything further down far less likely. Moving the marker a long way
 * takes a couple of seconds of clear evidence, so a stretch of
 * ambiguous strumming can't throw it far down the page.
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
// Jumps need well over a second of clear evidence (each frame of a
// better-fitting chord is worth ~1.25 nats against JUNK) to win.
const P_SECTION = 1e-6 // back to a section start (a repeat), or on to one of the next two
const P_FAR = 1e-14 // on to a section start further down the page (~3 s of clear evidence)
const P_LOST = 1e-16 // anywhere at all: a last resort (section jumps do the recovering)
/**
 * Every chord lasts at least this many frames (~0.37 s): each run is a
 * chain of MIN_FRAMES states the belief must walk through. Without it,
 * during a messy second (everything scoring JUNK) belief would creep down
 * the page a chord per frame and snowball wherever the audio then fits.
 */
const MIN_FRAMES = 4
/** A move of more than this many runs counts as a jump for the marker. */
const NEAR = 3
/**
 * Frames (~1.1 s) a far position must lead before the marker jumps there.
 * On top of the jump penalties above, a real jump shows up ~2-3 s after the
 * player takes it; a misheard second never does.
 */
const JUMP_FRAMES = 12
// No position scores below this: a strum BTC misreads, a muted chord or a
// passing melody note is "junk" wherever the player is, not evidence for
// some other place in the song.
const JUNK = 0.2
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
  /** Runs where a section starts. */
  private readonly sectionRuns: number[]
  /** templates[offset][kind] */
  private readonly templates: Float32Array[][]
  /** belief[((offset * runs) + r) * MIN_FRAMES + frame-in-chord], sums to 1. */
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
    /** Sheet indices where sections start (the first is always one). */
    sections: number[] = [],
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
    const starts = new Set([0, ...sections])
    this.sectionRuns = this.runs.flatMap((run, r) =>
      [...starts].some((i) => i >= run.start && i < run.start + run.length) ? [r] : [],
    )
    this.templates = Array.from({ length: 12 }, (_, o) => kinds.map((k) => template(mod12(k.root + o), k.quality)))
    this.belief = new Float64Array(12 * this.runs.length * MIN_FRAMES)
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
        // From the top. Starting mid-song is a section jump a few seconds
        // in; a starting guess spread over the song leaves faint copies
        // deep in it that coast along and take over when the audio
        // happens to match them, pulling the marker down the page.
        const pos = r === 0 ? 1 : 0
        // Already past the minimum: they may be partway into the chord.
        this.belief[(o * n + r) * MIN_FRAMES + MIN_FRAMES - 1] = (offsets[o] / total) * pos
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
    const K = MIN_FRAMES
    if (!silent && n > 0) {
      const b = this.belief
      const next = new Float64Array(b.length)
      const sectionStart = new Uint8Array(n)
      for (const r of this.sectionRuns) sectionStart[r] = 1
      // Run r's start is always a jump target; sectionRuns is sorted.
      const leak = P_SECTION + P_LOST
      const sr = this.sectionRuns
      let total = 0
      for (let o = 0; o < 12; o++) {
        const base = o * n
        // below[r]: belief in runs before r, for the jump sources by distance.
        const below = new Float64Array(n + 1)
        for (let r = 0; r < n; r++) {
          let m = 0
          for (let j = 0; j < K; j++) m += b[(base + r) * K + j]
          below[r + 1] = below[r] + m
        }
        const mass = below[n]
        // Emissions for this transposition's distinct chords.
        const fit = this.templates[o].map((t) => {
          let s = 0
          for (let c = 0; c < N_CHORDS; c++) if (t[c]) s += t[c] * probs[c]
          return Math.max(s, JUNK)
        })
        // Leaving run k's last state for the next run (longer runs are left less often).
        const last = (k: number) => b[(base + k) * K + K - 1]
        const exit = (k: number) => P_ADVANCE / this.runs[k].length
        for (let r = 0; r < n; r++) {
          const at = (base + r) * K
          const e = fit[this.runs[r].kind]
          // Entering the run.
          let enter = (P_LOST * mass) / n
          if (sectionStart[r]) {
            // From runs whose next or next-but-one section this is, and
            // from everything after it (repeats): the usual rate. From
            // further up the page: P_FAR.
            const si = sr.indexOf(r)
            const near = si >= 2 ? sr[si - 2] : 0
            enter += (P_SECTION * (mass - below[near]) + P_FAR * below[near]) / sr.length
          }
          if (r >= 1) enter += exit(r - 1) * last(r - 1)
          if (r >= 2) enter += P_SKIP * last(r - 2)
          const into = [enter]
          // Walking through the minimum length...
          for (let j = 1; j < K; j++) into.push(b[at + j - 1] * (1 - leak))
          // ...then staying as long as it takes.
          into[K - 1] += last(r) * (1 - exit(r) - P_SKIP - leak)
          for (let j = 0; j < K; j++) {
            next[at + j] = into[j] * e
            total += next[at + j]
          }
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
        for (let j = 0; j < K; j++) {
          const v = this.belief[(o * n + r) * K + j]
          marginal[r] += v
          byOffset[o] += v
        }
      }
    }
    let best = 0
    for (let r = 1; r < n; r++) if (marginal[r] > marginal[best]) best = r
    let offset = 0
    for (let o = 1; o < 12; o++) if (byOffset[o] > byOffset[offset]) offset = o

    if (!silent) this.inRun++
    // Hysteresis: a nearby move once the new run has led for two frames
    // (or at once when it's confident); a far one only after it has led
    // for a couple of seconds and is more likely than not.
    if (best !== this.shown) {
      if (best === this.pending) this.pendingFrames++
      else {
        this.pending = best
        this.pendingFrames = 1
      }
      const far = Math.abs(best - this.shown) > NEAR
      const move = far
        ? this.pendingFrames >= JUMP_FRAMES && marginal[best] > 0.5
        : this.pendingFrames >= 2 || marginal[best] > 0.6
      if (move) {
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A stand-in for Web Audio: a clock we move by hand, and a record of what
// was started when.
const started: { when: number; stopped?: number }[] = []
class FakeParam {
  value = 0
  setTargetAtTime() {}
  cancelScheduledValues() {}
}
class FakeNode {
  gain = new FakeParam()
  frequency = new FakeParam()
  Q = new FakeParam()
  threshold = new FakeParam()
  ratio = new FakeParam()
  type = ''
  connect(n: FakeNode) {
    return n
  }
}
class FakeSource extends FakeNode {
  buffer: { duration: number } | null = null
  onended: (() => void) | null = null
  private rec = { when: 0 } as { when: number; stopped?: number }
  start(when: number) {
    this.rec = { when }
    started.push(this.rec)
  }
  stop(when: number) {
    this.rec.stopped = when
  }
}
class FakeContext {
  static now = 0
  sampleRate = 8000
  destination = new FakeNode()
  get currentTime() {
    return FakeContext.now
  }
  resume() {
    return Promise.resolve()
  }
  createBiquadFilter = () => new FakeNode()
  createDynamicsCompressor = () => new FakeNode()
  createGain = () => new FakeNode()
  createBufferSource = () => new FakeSource()
  createBuffer = (_c: number, n: number) => ({ duration: n / 8000, getChannelData: () => new Float32Array(n) })
}

describe('playThrough', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('AudioContext', FakeContext)
    FakeContext.now = 0
    started.length = 0
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  /** Moves the audio clock and the timers along together. */
  const run = (seconds: number) => {
    for (let t = 0; t < seconds; t += 0.05) {
      FakeContext.now += 0.05
      vi.advanceTimersByTime(50)
    }
  }

  it('plays each chord for a bar, in order, then ends', async () => {
    const { playThrough } = await import('@/lib/pluck')
    const C = [null, 3, 2, 0, 1, 0]
    const G = [3, 2, 0, 0, 0, 3]
    const seen: [number, number][] = []
    let ended = false
    // 120 bpm: a bar is 2 s.
    playThrough([C, G, null, C], [40, 45, 50, 55, 59, 64], 0, 120, (i) => seen.push([i, FakeContext.now]), () => (ended = true))
    run(9)
    expect(seen.map(([i]) => i)).toEqual([0, 1, 2, 3])
    // Each chord lands on its bar line (to the 50 ms the fake clock steps by).
    seen.forEach(([i, t]) => expect(Math.abs(t - (0.1 + i * 2))).toBeLessThanOrEqual(0.06))
    expect(ended).toBe(true)
    // Three bars with a shape, six strums each: downs strike every sounding
    // string, ups the top four.
    const perBar = (s: number) => 3 * s + 3 * 4
    expect(started.length).toBe(perBar(5) + perBar(6) + perBar(5))
  })

  it('stops, including strums queued ahead', async () => {
    const { playThrough } = await import('@/lib/pluck')
    const C = [null, 3, 2, 0, 1, 0]
    const seen: number[] = []
    const stop = playThrough([C, C, C], [40, 45, 50, 55, 59, 64], 0, 60, (i) => seen.push(i), () => {})
    run(1)
    stop()
    const queuedLater = started.filter((s) => s.when > FakeContext.now)
    expect(queuedLater.every((s) => s.stopped !== undefined)).toBe(true)
    run(10)
    expect(seen).toEqual([0])
  })
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as ort from 'onnxruntime-web'
import { LiveChords, Leveler } from './live'
import { Follower } from './follow'
import { SR } from './cqt'
import { btcChord } from './btc'
import { parseChordPro } from '@/lib/chordpro'
import { playAlongChords } from './sheet'

ort.env.wasm.numThreads = 1

/** Sawtooth triads with a bass note, `seconds` per chord, and a little noise. */
function synth(chords: number[][], seconds: number): Float32Array {
  const per = Math.round(SR * seconds)
  const y = new Float32Array(per * chords.length)
  let seed = 1
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.004
  chords.forEach((notes, k) => {
    for (let i = 0; i < per; i++) {
      const t = i / SR
      let v = 0
      for (const m of [...notes, notes[0] - 12]) {
        const f = 440 * 2 ** ((m - 69) / 12)
        v += 0.1 * (2 * ((t * f) % 1) - 1)
      }
      // A strum's decay, so changes are audible as onsets.
      y[k * per + i] = v * (0.6 + 0.4 * Math.exp(-(t % 1) * 3)) + noise()
    }
  })
  return y
}

describe('play-along', () => {
  it('follows a synthesized performance of a sheet', async () => {
    const dir = join(__dirname, 'model')
    const session = await ort.InferenceSession.create(readFileSync(join(dir, 'btc.onnx')))
    const norm = JSON.parse(readFileSync(join(dir, 'btc.norm.json'), 'utf8'))
    const doc = parseChordPro(`{capo: 2}
[Verse]
[G]One line [D]of words
[Em]and then [C]another
[Chorus]
[C]Here's the [D]chorus [G]now`)
    const sheet = playAlongChords(doc)
    expect(sheet.chords.map((c) => c.root)).toEqual([7, 2, 4, 0, 0, 2, 7])
    // Played with a capo on 2: everything sounds two semitones up.
    const MIDI: Record<string, number[]> = { A: [57, 61, 64], E: [52, 56, 59], 'F#m': [54, 57, 61], D: [50, 54, 57] }
    const played = ['A', 'E', 'F#m', 'D', 'D', 'E', 'A']
    const audio = synth(played.map((c) => MIDI[c]), 2)

    const follower = new Follower(sheet.chords, [{ offset: 2, weight: 1 }])
    const marks: { time: number; index: number; offset: number; heard: string }[] = []
    const live = new LiveChords({ session, Tensor: ort.Tensor, norm }, (f) => {
      const p = follower.step(f.probs)
      const h = p.heard === null ? null : btcChord(p.heard)
      marks.push({ time: f.time, index: p.index, offset: p.offset, heard: h ? `${h.root}${h.quality}` : '-' })
    })
    for (let i = 0; i < audio.length; i += 2048) {
      live.push(audio.slice(i, i + 2048))
      await new Promise((r) => setTimeout(r, 0))
    }
    // Where the marker was a second into each chord.
    const at = (t: number) => marks.find((m) => m.time >= t)!
    expect(played.map((_, k) => at(k * 2 + 1).index)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(marks.at(-1)!.offset).toBe(2)
  }, 60_000)
})

describe('input leveling', () => {
  it('follows a very quiet performance', async () => {
    const dir = join(__dirname, 'model')
    const session = await ort.InferenceSession.create(readFileSync(join(dir, 'btc.onnx')))
    const norm = JSON.parse(readFileSync(join(dir, 'btc.norm.json'), 'utf8'))
    const MIDI: Record<string, number[]> = { G: [55, 59, 62], D: [50, 54, 57], Em: [52, 55, 59], C: [48, 52, 55] }
    const played = ['G', 'D', 'Em', 'C']
    // About -70 dBFS: a guitar across the room from a laptop, no gain control.
    const audio = synth(played.map((c) => MIDI[c]), 2).map((v) => v * 0.0003)
    const follower = new Follower([7, 2, 4, 0].map((root, i) => ({ root, quality: i === 2 ? 'min' : 'maj' })), [{ offset: 0, weight: 1 }])
    const marks: { time: number; index: number; level: number }[] = []
    const live = new LiveChords({ session, Tensor: ort.Tensor, norm }, (f) => marks.push({ time: f.time, index: follower.step(f.probs).index, level: f.level }))
    for (let i = 0; i < audio.length; i += 2048) {
      live.push(audio.slice(i, i + 2048))
      await new Promise((r) => setTimeout(r, 0))
    }
    // Once the leveler has caught up (a couple of seconds), it follows along.
    const at = (t: number) => marks.find((m) => m.time >= t)!
    expect([at(5).index, at(7).index]).toEqual([2, 3])
    expect(marks.at(-1)!.level).toBeLessThan(-60)
  }, 60_000)

  it('leaves silence silent', () => {
    const lv = new Leveler()
    const out = lv.process(new Float32Array(22050).fill(1e-6))
    expect(Math.max(...out)).toBeLessThan(1e-5)
    expect(lv.level).toBeLessThan(-90)
  })
})

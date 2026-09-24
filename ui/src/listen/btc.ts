/**
 * BTC (Bi-directional Transformer for Chord recognition, Park et al.,
 * ISMIR 2019; MIT, see model/LICENSE-BTC) with its 170-class large
 * vocabulary, exported to ONNX by chordex's ondevice spike.
 */
import type { InferenceSession, Tensor } from 'onnxruntime-web'
import type { Quality } from '@/lib/music'
import { N_BINS } from './cqt'

export const TIMESTEP = 108 // frames per block (10 s)
export const N_CHORDS = 170
export const UNKNOWN_CHORD = 168
export const NO_CHORD = 169
export const FRAME_SECONDS = 10 / TIMESTEP

const QUALITIES: Quality[] = ['min', 'maj', 'dim', 'aug', 'min6', 'maj6', 'min7', 'minmaj7', 'maj7', '7', 'dim7', 'hdim7', 'sus2', 'sus4']

/** Class index → chord, or null for "no chord" / "unknown". */
export function btcChord(idx: number): { root: number; quality: Quality } | null {
  if (idx >= UNKNOWN_CHORD) return null
  return { root: Math.floor(idx / 14), quality: QUALITIES[idx % 14] }
}

export function btcClass(root: number, quality: Quality): number | null {
  const q = QUALITIES.indexOf(quality)
  return q < 0 ? null : root * 14 + q
}

export interface BTC {
  session: InferenceSession
  Tensor: typeof Tensor
  norm: { mean: number[]; std: number[] }
}

/** Chord probabilities, (frames, 170) row-major, for up to 108 frames of log-CQT. */
export async function btcProbs(m: BTC, frames: Float32Array[]): Promise<Float32Array> {
  const x = new Float32Array(TIMESTEP * N_BINS) // zero padded, as the model was run in Python
  frames.forEach((f, t) => {
    for (let k = 0; k < N_BINS; k++) x[t * N_BINS + k] = (f[k] - m.norm.mean[k]) / m.norm.std[k]
  })
  const out = await m.session.run({ x: new m.Tensor('float32', x, [1, TIMESTEP, N_BINS]) })
  return (out.probs.data as Float32Array).slice(0, frames.length * N_CHORDS)
}

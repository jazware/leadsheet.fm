/**
 * Play-along off the main thread: CQT frames, BTC (onnxruntime-web on
 * single-threaded WASM, no special headers needed) and the follower.
 */
import * as ort from 'onnxruntime-web/wasm'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import modelUrl from './model/btc.onnx?url'
import norm from './model/btc.norm.json'
import { LiveChords } from './live'
import { Follower, type SheetChord } from './follow'
import type { BTC } from './btc'

ort.env.wasm.wasmPaths = { wasm: wasmUrl }
ort.env.wasm.numThreads = 1

export type ToWorker =
  | { type: 'start'; chords: SheetChord[]; sections: number[]; prior: { offset: number; weight: number }[] }
  | { type: 'audio'; samples: Float32Array }
  | { type: 'stop' }

export type FromWorker =
  | { type: 'progress'; fraction: number }
  | { type: 'ready' }
  | { type: 'position'; index: number; offset: number; heard: number | null; silent: boolean; delay: number }
  | { type: 'error'; message: string }

const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m)

let model: Promise<BTC> | null = null
let live: LiveChords | null = null

async function load(): Promise<BTC> {
  const res = await fetch(modelUrl)
  if (!res.ok || !res.body) throw new Error(`chord model: HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length')) || 13_000_000
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    got += value.length
    post({ type: 'progress', fraction: Math.min(1, got / total) })
  }
  const bytes = new Uint8Array(got)
  let o = 0
  for (const p of parts) {
    bytes.set(p, o)
    o += p.length
  }
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] })
  return { session, Tensor: ort.Tensor, norm }
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const m = e.data
  try {
    if (m.type === 'start') {
      live = null
      model ??= load()
      const btc = await model.catch((err) => {
        model = null
        throw err
      })
      const follower = new Follower(m.chords, m.prior, m.sections)
      live = new LiveChords(btc, (f) => {
        const p = follower.step(f.probs)
        post({ type: 'position', index: p.index, offset: p.offset, heard: p.heard, silent: p.silent, delay: f.delay })
      })
      post({ type: 'ready' })
    } else if (m.type === 'audio') {
      live?.push(m.samples)
    } else if (m.type === 'stop') {
      live = null
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

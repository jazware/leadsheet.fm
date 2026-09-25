import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Doc, Segment } from '@/lib/chordpro'
import captureUrl from './capture.worklet.js?url'
import { SR } from './cqt'
import { playAlongChords } from './sheet'
import type { FromWorker, ToWorker } from './worker'

export type PlayAlongState =
  | { status: 'off' }
  | { status: 'loading'; fraction: number }
  | { status: 'listening'; now: Segment | null; heard: number | null; silent: boolean; offset: number; level: number }
  | { status: 'error'; message: string }

/**
 * Listens through the microphone and follows the player through the
 * sheet. Everything runs on this device; no audio leaves it.
 * `prior` is which transpositions (written → sounding, in semitones) to
 * expect, most likely first.
 */
export function usePlayAlong(doc: Doc, prior: { offset: number; weight: number }[]) {
  const sheet = useMemo(() => playAlongChords(doc), [doc])
  const [state, setState] = useState<PlayAlongState>({ status: 'off' })
  const worker = useRef<Worker | null>(null)
  const stopAudio = useRef<(() => void) | null>(null)
  const priorRef = useRef(prior)
  priorRef.current = prior
  // Bumped by every start and stop, so a start still waiting on the
  // microphone knows it's been cancelled.
  const run = useRef(0)

  const stop = useCallback(() => {
    run.current++
    stopAudio.current?.()
    stopAudio.current = null
    worker.current?.postMessage({ type: 'stop' } satisfies ToWorker)
    setState({ status: 'off' })
  }, [])

  const start = useCallback(async () => {
    if (!sheet.chords.length) return
    stopAudio.current?.()
    stopAudio.current = null
    const id = ++run.current
    // Created inside the tap so browsers let it make sound (well, listen).
    let ctx = new AudioContext({ sampleRate: SR })
    setState({ status: 'loading', fraction: 0 })
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
    } catch (err) {
      void ctx.close()
      if (id !== run.current) return
      const denied = err instanceof DOMException && err.name === 'NotAllowedError'
      setState({
        status: 'error',
        message: denied ? 'Leadsheet needs the microphone to follow along. Allow it in your browser and try again.' : `Couldn't open the microphone: ${err}`,
      })
      return
    }

    if (id !== run.current) {
      stream.getTracks().forEach((t) => t.stop())
      void ctx.close()
      return
    }
    // From here the mic is open: stopping, or a failure setting up, must let it go.
    const closeCtx = () => {
      if (ctx.state !== 'closed') void ctx.close()
    }
    stopAudio.current = () => {
      stream.getTracks().forEach((t) => t.stop())
      closeCtx()
    }
    try {
      let source: MediaStreamAudioSourceNode
      try {
        source = ctx.createMediaStreamSource(stream)
      } catch {
        // Firefox won't connect a mic to a context at another rate: resample ourselves.
        closeCtx()
        ctx = new AudioContext()
        source = ctx.createMediaStreamSource(stream)
      }
      await ctx.resume()
      if (id !== run.current) return
      const resample = resampler(ctx.sampleRate / SR)

      const w = (worker.current ??= new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }))
      let last = ''
      w.onmessage = (e: MessageEvent<FromWorker>) => {
        const m = e.data
        if (id !== run.current) return // from a run that's been stopped
        if (m.type === 'progress') setState({ status: 'loading', fraction: m.fraction })
        else if (m.type === 'ready') setState({ status: 'listening', now: null, heard: null, silent: true, offset: 0, level: 0 })
        else if (m.type === 'error') {
          stopAudio.current?.()
          stopAudio.current = null
          setState({ status: 'error', message: `The chord listener stopped: ${m.message}` })
        } else if (m.type === 'position') {
          // Only re-render when something visible changes.
          // (The level only matters to the nearest 10 dB: is anything coming in.)
          const key = `${m.index}|${m.heard}|${m.silent}|${m.offset}|${Math.round(m.level / 10)}`
          if (key === last) return
          last = key
          setState({ status: 'listening', now: sheet.segments[m.index] ?? null, heard: m.heard, silent: m.silent, offset: m.offset, level: m.level })
        }
      }
      w.postMessage({ type: 'start', chords: sheet.chords, sections: sheet.sections, prior: priorRef.current } satisfies ToWorker)

      await ctx.audioWorklet.addModule(captureUrl)
      if (id !== run.current) return // stopped: stopAudio already let the mic go
      const node = new AudioWorkletNode(ctx, 'leadsheet-capture')
      node.port.onmessage = (e: MessageEvent<Float32Array>) => {
        const samples = resample(e.data)
        w.postMessage({ type: 'audio', samples } satisfies ToWorker, [samples.buffer])
      }
      source.connect(node)
      // Keep the graph pulling audio without playing anything.
      const mute = ctx.createGain()
      mute.gain.value = 0
      node.connect(mute).connect(ctx.destination)

      stopAudio.current = () => {
        stream.getTracks().forEach((t) => t.stop())
        node.port.onmessage = null
        closeCtx()
      }
    } catch (err) {
      if (id !== run.current) return
      stopAudio.current?.()
      stopAudio.current = null
      worker.current?.postMessage({ type: 'stop' } satisfies ToWorker)
      setState({ status: 'error', message: `Couldn't start listening: ${err instanceof Error ? err.message : err}` })
    }
  }, [sheet])

  useEffect(
    () => () => {
      stopAudio.current?.()
      worker.current?.terminate()
    },
    [],
  )

  return { state, start, stop, active: state.status === 'loading' || state.status === 'listening' }
}

/** Linear-interpolation resampler for a stream of blocks (ratio = in/out rate). */
function resampler(ratio: number) {
  if (ratio === 1) return (x: Float32Array) => x
  let phase = 0
  let prev = 0
  return (x: Float32Array) => {
    const out: number[] = []
    for (; phase < x.length; phase += ratio) {
      const i = Math.floor(phase)
      const f = phase - i
      const a = i === 0 ? prev : x[i - 1]
      out.push(a + (x[i] - a) * f)
    }
    phase -= x.length
    prev = x[x.length - 1]
    return Float32Array.from(out)
  }
}

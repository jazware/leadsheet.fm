/**
 * One frame of the constant-Q transform BTC was trained on:
 * librosa.cqt(sr=22050, n_bins=144, bins_per_octave=24, hop_length=2048,
 * fmin=C1), magnitude, then log(|x| + 1e-6). The same wavelet inner
 * products librosa takes, done directly at full rate (librosa goes octave
 * by octave on a resampled signal). Checked against librosa in chordex's
 * ondevice spike, where BTC picks the same chord on >99% of frames.
 */

export const SR = 22050
export const HOP = 2048
export const N_BINS = 144
const BPO = 24
const FMIN = 32.70319566257483 // C1

interface Filter {
  re: Float32Array
  im: Float32Array
  /** Offset of the first tap from the frame centre. */
  start: number
}

function buildFilters(): Filter[] {
  const freqs = Array.from({ length: N_BINS }, (_, k) => FMIN * 2 ** (k / BPO))
  const logf = freqs.map(Math.log2)
  return freqs.map((freq, k) => {
    // librosa.filters._relative_bandwidth, then wavelet_lengths (filter_scale 1, gamma 0).
    const bpo =
      k === 0 ? 1 / (logf[1] - logf[0])
      : k === N_BINS - 1 ? 1 / (logf[k] - logf[k - 1])
      : 2 / (logf[k + 1] - logf[k - 1])
    const alpha = (2 ** (2 / bpo) - 1) / (2 ** (2 / bpo) + 1)
    const length = SR / alpha / freq
    // np.arange(-ilen // 2, ilen // 2): floor division on a float length.
    const first = Math.floor(-length / 2)
    const n = Math.floor(length / 2) - first
    const hann = (i: number) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n) // periodic
    let l1 = 0
    for (let i = 0; i < n; i++) l1 += hann(i)
    // norm=1 (divide by L1), then librosa's scale=True leaves sqrt(length).
    const gain = Math.sqrt(length) / l1
    const re = new Float32Array(n)
    const im = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const ph = (2 * Math.PI * freq * (first + i)) / SR
      re[i] = hann(i) * Math.cos(ph) * gain
      im[i] = hann(i) * Math.sin(ph) * gain
    }
    // pad_center puts the filter's middle on the frame centre.
    return { re, im, start: -Math.floor(n / 2) }
  })
}

let cached: Filter[] | null = null
const filters = () => (cached ??= buildFilters())

/** Samples needed after a frame's centre before it can be computed. */
export function cqtReach() {
  const f = filters()[0]
  return f.re.length + f.start
}

/** Log-CQT of the frame centred on sample `centre` of `y` (zeros outside it). */
export function cqtFrame(y: Float32Array, centre: number): Float32Array {
  const out = new Float32Array(N_BINS)
  const fs = filters()
  for (let k = 0; k < N_BINS; k++) {
    const { re, im, start } = fs[k]
    const s0 = centre + start
    const lo = Math.max(0, -s0)
    const hi = Math.min(re.length, y.length - s0)
    let ar = 0
    let ai = 0
    for (let i = lo; i < hi; i++) {
      const x = y[s0 + i]
      ar += x * re[i]
      ai += x * im[i]
    }
    out[k] = Math.log(Math.hypot(ar, ai) + 1e-6)
  }
  return out
}

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useContext, useEffect, useRef } from 'react'
import { ChordSoundContext, usePianoVoicing, useVoicing } from '@/components/Voicings'
import { fretsKey } from '@/lib/guitar'
import { audioStarted, playChord, strum } from '@/lib/pluck'
import { noteName, pretty, type ChordSymbol } from '@/lib/music'
import { instrumentFor, STANDARD_STRINGS, TUNINGS, type Instrument } from '@/lib/tunings'

const FRETS = 5
const W = 72
const H = 88
const PAD_X = 10
const TOP = 18
const GAP_Y = (H - TOP - 6) / FRETS

type DiagramProps = {
  chord: ChordSymbol
  label: string
  flats: boolean
  /** Open-string pitches the shape is for; labelled under the box unless standard. */
  strings?: number[]
  /** Piano draws a keyboard; anything else, a fretboard box for `strings`. */
  instrument?: Instrument
  cycle?: boolean
}

/**
 * A chord's shape: a fretted chord box (the easiest voicing we know, or
 * the one the reader picked), or on piano a keyboard. With `cycle`,
 * arrows under it step through the others.
 */
export function ChordDiagram(props: DiagramProps) {
  return props.instrument === 'piano' ? <PianoDiagram {...props} /> : <FrettedDiagram {...props} />
}

function FrettedDiagram({
  chord,
  label,
  flats,
  strings = STANDARD_STRINGS,
  cycle,
}: DiagramProps) {
  const { voicing: v, index, shapes, step: stepVoicing, own } = useVoicing(chord, strings)
  const sound = useContext(ChordSoundContext)
  const play = () => v && sound && strum(v.frets, sound.strings, sound.capo, sound.instrument)
  // Once the reader has heard a chord, stepping to another shape plays it,
  // so shapes can be compared by ear.
  const stepped = useRef(false)
  const step = (d: number) => {
    stepped.current = audioStarted()
    stepVoicing(d)
  }
  const heard = v ? fretsKey(v.frets) : ''
  useEffect(() => {
    if (stepped.current) play()
    stepped.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heard])
  // Name the strings under the box unless it's the instrument's standard tuning.
  const instrument = instrumentFor(strings)
  const usual = TUNINGS.find((t) => t.instrument === instrument)!.strings
  const standard = strings.length === usual.length && strings.every((s, i) => s === usual[i])
  const gap = (W - PAD_X * 2) / (strings.length - 1)
  const fretted = v?.frets.filter((f): f is number => f !== null && f > 0) ?? []
  const maxFret = fretted.length ? Math.max(...fretted) : 0
  // Shift the window up the neck when the shape doesn't fit first position.
  const base = maxFret > FRETS ? Math.min(...fretted) : 1
  const sx = (s: number) => PAD_X + s * gap
  const fy = (f: number) => TOP + (f - base + 0.5) * GAP_Y

  const box = v && (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-16 text-ink"
      role="img"
      aria-label={`${label}: ${v.frets.map((f) => (f === null ? 'x' : f)).join(' ')}`}
    >
      {base === 1 ? (
        <rect x={PAD_X - 1} y={TOP - 3} width={W - PAD_X * 2 + 2} height={3} fill="currentColor" />
      ) : (
        <text x={1} y={TOP + GAP_Y * 0.7} fontSize={9} fill="currentColor" className="font-sans">
          {base}
        </text>
      )}
      {Array.from({ length: FRETS + 1 }, (_, i) => (
        <line key={`f${i}`} x1={PAD_X} x2={W - PAD_X} y1={TOP + i * GAP_Y} y2={TOP + i * GAP_Y}
          stroke="currentColor" strokeOpacity={0.35} strokeWidth={1} />
      ))}
      {strings.map((_, s) => (
        <line key={`s${s}`} x1={sx(s)} x2={sx(s)} y1={TOP} y2={TOP + FRETS * GAP_Y}
          stroke="currentColor" strokeOpacity={0.55} strokeWidth={1} />
      ))}
      {v.barre && (
        <rect
          x={sx(v.barre.from) - 3.5}
          y={fy(v.barre.fret) - 3.5}
          width={sx(v.barre.to) - sx(v.barre.from) + 7}
          height={7}
          rx={3.5}
          fill="currentColor"
        />
      )}
      {v.frets.map((f, s) =>
        f === null ? (
          <text key={s} x={sx(s)} y={TOP - 6} fontSize={8} textAnchor="middle" fill="currentColor">
            ×
          </text>
        ) : f === 0 ? (
          <circle key={s} cx={sx(s)} cy={TOP - 8} r={2.6} fill="none" stroke="currentColor" strokeWidth={1} />
        ) : v.barre && f === v.barre.fret && s >= v.barre.from && s <= v.barre.to ? null : (
          <circle key={s} cx={sx(s)} cy={fy(f)} r={3.6} fill="currentColor" />
        ),
      )}
    </svg>
  )

  return (
    // relative: the screen-reader-only counter text is absolutely positioned,
    // and must stay inside the box (in the phone's scrolling Shapes strip
    // it otherwise widens the whole page).
    <figure className="relative flex w-[4.9rem] shrink-0 flex-col items-center rounded-2xl bg-surface px-1 pb-1.5 pt-2.5">
      <figcaption className="mb-1 text-base font-black leading-none text-chord">
        {pretty(label)}
      </figcaption>
      {v ? (
        sound ? (
          <button
            type="button"
            className="rounded-lg hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-chord"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation()
              play()
            }}
            aria-label={`Hear ${label}`}
            title="Hear it"
          >
            {box}
          </button>
        ) : (
          box
        )
      ) : (
        <div className="flex h-[5.5rem] w-16 items-center justify-center text-center text-[0.65rem] font-bold leading-tight text-ink-soft">
          no shape for this one yet
        </div>
      )}
      {!standard && v && (
        <div className="flex w-16 justify-between px-[0.35rem] text-[0.55rem] font-bold leading-none text-ink-soft" aria-hidden>
          {strings.map((m, i) => (
            <span key={i} className="w-0 text-center">
              {noteName(m, flats)}
            </span>
          ))}
        </div>
      )}
      {cycle && shapes.length > 1 && <Cycle label={label} index={index} count={shapes.length} own={own} step={step} />}
    </figure>
  )
}

/** The ‹ n/m › row under a diagram. */
function Cycle({ label, index, count, own, step }: { label: string; index: number; count: number; own?: boolean; step: (d: number) => void }) {
  return (
    
    <div className="mt-1 flex w-full items-center justify-between text-ink-soft">
      {/* mousedown kept from the chord name's button, so its tooltip stays open. */}
      <button
        type="button"
        tabIndex={-1}
        className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-surface-raised hover:text-ink"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation()
          step(-1)
        }}
        aria-label={`Previous ${label} voicing`}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </button>
      <span className="flex items-center gap-1 text-[0.65rem] font-extrabold tabular-nums" aria-live="polite">
        {own && <span className="h-1.5 w-1.5 rounded-full bg-chord" title="The sheet's shape" aria-hidden />}
        <span className="sr-only">Voicing </span>
        {index + 1}
        <span aria-hidden>/</span>
        <span className="sr-only"> of </span>
        {count}
        {own && <span className="sr-only">, the sheet's shape</span>}
      </span>
      <button
        type="button"
        tabIndex={-1}
        className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-surface-raised hover:text-ink"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation()
          step(1)
        }}
        aria-label={`Next ${label} voicing`}
      >
        <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
    </div>
  )
}

// A keyboard two octaves wide.
const KEYS_W = 112
const KEYS_H = 40
const WHITE = [0, 2, 4, 5, 7, 9, 11]

/**
 * A chord on piano: the right hand's keys marked on two octaves, the left
 * hand's bass note named under them. Steps through inversions.
 */
function PianoDiagram({ chord, label, flats, cycle }: DiagramProps) {
  const { voicing: v, index, shapes, step: stepVoicing } = usePianoVoicing(chord)
  const sound = useContext(ChordSoundContext)
  const play = () => v && playChord(v.notes, 'piano')
  const stepped = useRef(false)
  const step = (d: number) => {
    stepped.current = audioStarted()
    stepVoicing(d)
  }
  const heard = v ? v.notes.join(',') : ''
  useEffect(() => {
    if (stepped.current) play()
    stepped.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heard])
  const [lh, ...rh] = v?.notes ?? []
  // Two octaves from the C at or below the right hand.
  const from = rh.length ? rh[0] - (rh[0] % 12) : 60
  const whiteW = KEYS_W / 14
  const keyX = (midi: number) => {
    const octave = Math.floor((midi - from) / 12)
    const pc = midi % 12
    const white = WHITE.indexOf(pc)
    if (white >= 0) return { x: (octave * 7 + white) * whiteW, black: false }
    return { x: (octave * 7 + WHITE.indexOf(pc - 1) + 1) * whiteW - whiteW * 0.3, black: true }
  }
  const box = v && (
    <svg viewBox={`0 0 ${KEYS_W} ${KEYS_H}`} className="w-24 text-ink" role="img" aria-label={`${label}: ${rh.map((n) => noteName(n, flats)).join(' ')}, ${noteName(lh, flats)} in the bass`}>
      {Array.from({ length: 14 }, (_, i) => (
        <rect key={`w${i}`} x={i * whiteW + 0.5} y={0.5} width={whiteW - 1} height={KEYS_H - 1} rx={1.5} fill="currentColor" fillOpacity={0.9} />
      ))}
      {Array.from({ length: 24 }, (_, i) => from + i)
        .filter((m) => !WHITE.includes(m % 12))
        .map((m) => (
          <rect key={`b${m}`} x={keyX(m).x} y={0} width={whiteW * 0.6} height={KEYS_H * 0.6} rx={1} className="fill-bg" />
        ))}
      {rh.map((m) => {
        const k = keyX(m)
        const cx = k.black ? k.x + whiteW * 0.3 : k.x + whiteW / 2
        return <circle key={m} cx={cx} cy={k.black ? KEYS_H * 0.45 : KEYS_H * 0.8} r={2.8} className="fill-chord" />
      })}
    </svg>
  )
  return (
    <figure className="relative flex w-[6.75rem] shrink-0 flex-col items-center rounded-2xl bg-surface px-1 pb-1.5 pt-2.5">
      <figcaption className="mb-1.5 text-base font-black leading-none text-chord">{pretty(label)}</figcaption>
      {v ? (
        sound ? (
          <button
            type="button"
            className="rounded-lg p-0.5 hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-chord"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation()
              play()
            }}
            aria-label={`Hear ${label}`}
            title="Hear it"
          >
            {box}
          </button>
        ) : (
          box
        )
      ) : (
        <div className="flex h-10 w-24 items-center justify-center text-center text-[0.65rem] font-bold leading-tight text-ink-soft">
          no voicing for this one yet
        </div>
      )}
      {v && (
        <div className="mt-1 text-[0.65rem] font-bold text-ink-soft">
          bass {pretty(noteName(lh, flats))}
          {v.inversion > 0 && <> · {['', '1st', '2nd', '3rd'][v.inversion]} inv.</>}
        </div>
      )}
      {cycle && shapes.length > 1 && <Cycle label={label} index={index} count={shapes.length} step={step} />}
    </figure>
  )
}

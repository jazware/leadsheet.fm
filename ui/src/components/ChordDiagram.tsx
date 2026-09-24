import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useVoicing } from '@/components/Voicings'
import { noteName, pretty, type ChordSymbol } from '@/lib/music'
import { STANDARD_STRINGS } from '@/lib/tunings'

const STRINGS = 6
const FRETS = 5
const W = 72
const H = 88
const PAD_X = 10
const TOP = 18
const GAP_X = (W - PAD_X * 2) / (STRINGS - 1)
const GAP_Y = (H - TOP - 6) / FRETS

/**
 * A guitar chord box: the easiest voicing we know, or the one the reader
 * picked for this chord. With `cycle`, arrows under the box step through
 * the others.
 */
export function ChordDiagram({
  chord,
  label,
  flats,
  strings = STANDARD_STRINGS,
  cycle,
}: {
  chord: ChordSymbol
  label: string
  flats: boolean
  /** Open-string pitches the shape is for; labelled under the box unless standard. */
  strings?: number[]
  cycle?: boolean
}) {
  const { voicing: v, index, shapes, step, own } = useVoicing(chord, strings)
  const standard = strings.every((s, i) => s === STANDARD_STRINGS[i])
  const fretted = v?.frets.filter((f): f is number => f !== null && f > 0) ?? []
  const maxFret = fretted.length ? Math.max(...fretted) : 0
  // Shift the window up the neck when the shape doesn't fit first position.
  const base = maxFret > FRETS ? Math.min(...fretted) : 1
  const sx = (s: number) => PAD_X + s * GAP_X
  const fy = (f: number) => TOP + (f - base + 0.5) * GAP_Y

  return (
    <figure className="flex w-[4.9rem] shrink-0 flex-col items-center rounded-2xl bg-surface px-1 pb-1.5 pt-2.5">
      <figcaption className="mb-1 text-base font-black leading-none text-chord">
        {pretty(label)}
      </figcaption>
      {v ? (
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
          {Array.from({ length: STRINGS }, (_, s) => (
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
      {cycle && shapes.length > 1 && (
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
            {shapes.length}
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
      )}
    </figure>
  )
}

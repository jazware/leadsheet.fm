import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Play, Square } from 'lucide-react'
import { StrokeGlyph } from '@/components/Strum'
import { chordPitches, playThrough } from '@/lib/pluck'
import { beatsPerBar, parsePattern, strokeCounts, strumEvents, type Stroke } from '@/lib/strum'
import { STANDARD_STRINGS } from '@/lib/tunings'

type Time = '4/4' | '3/4' | '6/8'
type Grid = 'quarters' | 'eighths' | 'sixteenths'
type Slot = 'D' | 'U' | 'x' | '.'

const PER_BEAT: Record<Grid, number> = { quarters: 1, eighths: 2, sixteenths: 4 }
const NEXT: Record<Slot, Slot> = { D: 'U', U: 'x', x: '.', '.': 'D' }
const WORD: Record<Slot, string> = { D: 'down', U: 'up', x: 'chuck', '.': 'miss' }
const KIND: Record<Slot, Stroke['kind']> = { D: 'down', U: 'up', x: 'chuck', '.': 'miss' }

const PRESETS: { name: string; time: Time; grid: Grid; pattern: string }[] = [
  { name: 'Old faithful', time: '4/4', grid: 'eighths', pattern: 'D.DU.UDU' },
  { name: 'Straight eighths', time: '4/4', grid: 'eighths', pattern: 'DUDUDUDU' },
  { name: 'Driving quarters', time: '4/4', grid: 'quarters', pattern: 'DDDD' },
  { name: 'Waltz', time: '3/4', grid: 'eighths', pattern: 'D.DUDU' },
  { name: 'Six-eight', time: '6/8', grid: 'eighths', pattern: 'DDUDDU' },
  { name: 'Funk sixteenths', time: '4/4', grid: 'sixteenths', pattern: 'D.xUD.xUD.xUD.xU' },
]

const slotCount = (time: Time, grid: Grid) => (time === '6/8' ? 6 : beatsPerBar(time) * PER_BEAT[grid])
const fit = (slots: Slot[], n: number): Slot[] => Array.from({ length: n }, (_, i) => slots[i] ?? '.')

/**
 * Builds an {x_strum: …} directive: tap slots to cycle down, up, chuck,
 * miss; pick the time and grid, or start from a preset; hear it; insert
 * it at the cursor.
 */
export function StrumBuilder({
  sheetTime,
  bpm,
  onInsert,
  onClose,
}: {
  /** The sheet's {time}, if it has one. */
  sheetTime?: string
  bpm: number
  onInsert: (directive: string) => void
  onClose: () => void
}) {
  const [time, setTime] = useState<Time>(sheetTime === '3/4' || sheetTime === '6/8' ? sheetTime : '4/4')
  const [grid, setGrid] = useState<Grid>('eighths')
  const [slots, setSlots] = useState<Slot[]>(fit('D.DU.UDU'.split('') as Slot[], slotCount(time, 'eighths')))
  const [name, setName] = useState('')
  const [playing, setPlaying] = useState(false)
  const stop = useRef<(() => void) | null>(null)
  useEffect(() => () => stop.current?.(), [])

  const source = slots.join('')
  const pattern = parsePattern(source)
  const per = time === '6/8' ? 1 : PER_BEAT[grid]
  const counts = strokeCounts(slots.map((s) => ({ kind: KIND[s], accent: false })), time)
  // Beats as groups, so sixteenths wrap a beat at a time on narrow screens.
  const beats: number[][] = []
  slots.forEach((_, i) => (i % per === 0 ? beats.push([i]) : beats[beats.length - 1].push(i)))

  const choose = (t: Time, g: Grid, next?: Slot[]) => {
    const gg = t === '6/8' ? 'eighths' : g
    setTime(t)
    setGrid(gg)
    setSlots(fit(next ?? slots, slotCount(t, gg)))
  }
  const cleanName = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  const directive = `${time !== '4/4' && time !== sheetTime ? `{time: ${time}}\n` : ''}{x_strum: ${cleanName ? `${cleanName} ` : ''}${source}}`

  const hear = () => {
    stop.current?.()
    if (playing || !pattern) {
      stop.current = null
      setPlaying(false)
      return
    }
    // Two bars on a C chord.
    const notes = chordPitches([-1, 3, 2, 0, 1, 0], STANDARD_STRINGS, 0)
    const barBeats = beatsPerBar(time)
    const bar = { notes, beats: barBeats, strokes: strumEvents(pattern.bars[0], barBeats) }
    stop.current = playThrough([bar, bar], bpm, () => {}, () => setPlaying(false))
    setPlaying(true)
  }

  const segBtn = (on: boolean) =>
    clsx('h-9 rounded-full px-3 text-sm font-extrabold', on ? 'bg-glow text-glow-ink' : 'text-ink-soft hover:text-ink')

  return (
    <div className="flex flex-col gap-4 rounded-[20px] bg-surface p-4" role="group" aria-label="Strumming pattern builder">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-black">Strumming pattern</div>
          <div className="text-sm font-semibold text-ink-soft">Tap a slot to change it: down, up, chuck, miss.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <div role="group" aria-label="Time signature" className="flex gap-0.5 rounded-full bg-surface-raised p-1">
            {(['4/4', '3/4', '6/8'] as Time[]).map((t) => (
              <button key={t} type="button" aria-pressed={time === t} className={segBtn(time === t)} onClick={() => choose(t, grid)}>
                {t}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Grid" className="flex gap-0.5 rounded-full bg-surface-raised p-1">
            {(
              [
                ['quarters', '♩', 'Quarter notes'],
                ['eighths', '♪', 'Eighth notes'],
                ['sixteenths', '♬', 'Sixteenth notes'],
              ] as [Grid, string, string][]
            ).map(([g, sym, label]) => (
              <button
                key={g}
                type="button"
                aria-label={label}
                title={label}
                aria-pressed={grid === g}
                disabled={time === '6/8' && g !== 'eighths'}
                className={clsx(segBtn(grid === g), 'min-w-10 text-lg leading-none disabled:opacity-40')}
                onClick={() => choose(time, g)}
              >
                {sym}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-2">
        {beats.map((beat, b) => (
          <div key={b} className="flex gap-1">
            {beat.map((i) => (
              <button
                key={i}
                type="button"
                aria-label={`Count ${counts[i].count}: ${WORD[slots[i]]}. Tap to change.`}
                onClick={() => setSlots((s) => s.map((x, j) => (j === i ? NEXT[x] : x)))}
                className={clsx(
                  'flex h-[4.5rem] w-11 flex-col items-center justify-center gap-2 rounded-2xl',
                  slots[i] === '.' ? 'bg-bg' : 'bg-surface-raised',
                  'hover:ring-2 hover:ring-rule',
                )}
              >
                <span className="flex h-6 w-6 items-center justify-center">
                  <StrokeGlyph stroke={{ kind: KIND[slots[i]], accent: false }} size={24} dot="h-1.5 w-1.5" on={false} />
                </span>
                <span className={clsx('text-xs font-black leading-none', counts[i].beat ? 'text-ink-soft' : 'text-ink-faint')}>{counts[i].count}</span>
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-extrabold text-ink-soft">Start from</span>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => {
            const on = p.time === time && (p.time === '6/8' || p.grid === grid) && p.pattern === source
            return (
              <button
                key={p.name}
                type="button"
                aria-pressed={on}
                className={clsx('btn btn-sm border-2', on ? 'border-glow' : 'border-transparent bg-surface-raised')}
                onClick={() => choose(p.time, p.grid, p.pattern.split('') as Slot[])}
              >
                {p.name}
              </button>
            )
          })}
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-extrabold text-ink-soft">Name (optional, to switch back to it later: verse, chorus…)</span>
        <input className="field bg-bg" value={name} onChange={(e) => setName(e.target.value)} placeholder="verse" />
      </label>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-bg px-3.5 py-3">
        <code className="whitespace-pre font-mono text-sm text-ink-soft">{directive}</code>
        <div className="flex gap-2">
          <button type="button" className="btn btn-sm" onClick={hear} disabled={!pattern}>
            {playing ? <Square className="h-4 w-4 fill-current" aria-hidden /> : <Play className="h-4 w-4 fill-current" aria-hidden />}
            {playing ? 'Stop' : 'Hear it'}
          </button>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn btn-sm btn-accent"
            disabled={!pattern}
            onClick={() => {
              stop.current?.()
              onInsert(`${directive}\n`)
            }}
          >
            Insert
          </button>
        </div>
      </div>
      <p className="text-sm font-semibold text-ink-soft">
        Goes in where the cursor is: at the top for the whole sheet, or just before a section (or line) to change the pattern from
        there.{cleanName && <> Later, <code className="font-mono">{`{x_strum: ${cleanName}}`}</code> switches back to it.</>}
      </p>
    </div>
  )
}

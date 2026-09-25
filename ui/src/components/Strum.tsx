import { clsx } from 'clsx'
import { describePattern, strokeCounts, type StrumChange, type StrumPattern, type Stroke } from '@/lib/strum'

type Size = 'xs' | 'sm' | 'md' | 'lg'

// Cell width, arrow size and count size per strip size, in px.
const SIZES: Record<Size, { cell: number; arrow: number; count: string; dot: string; gap: number }> = {
  xs: { cell: 11, arrow: 11, count: '', dot: 'h-[3px] w-[3px]', gap: 2 },
  sm: { cell: 20, arrow: 14, count: 'text-[9px]', dot: 'h-1 w-1', gap: 4 },
  md: { cell: 26, arrow: 18, count: 'text-[11px]', dot: 'h-[5px] w-[5px]', gap: 5 },
  lg: { cell: 44, arrow: 30, count: 'text-[15px]', dot: 'h-2 w-2', gap: 8 },
}

/**
 * A strumming pattern as arrows over the count: misses as faint dots (the
 * hand keeps moving), accents in the chord color, the stroke being played
 * (`lit`, counting across bars) highlighted.
 */
export function StrumStrip({
  pattern,
  time,
  size = 'md',
  lit = -1,
  className,
}: {
  pattern: StrumPattern
  time?: string
  size?: Size
  lit?: number
  className?: string
}) {
  const z = SIZES[size]
  let i = 0
  return (
    <div role="img" aria-label={describePattern(pattern)} className={clsx('flex items-end', className)}>
      {pattern.bars.map((bar, b) => {
        const counts = strokeCounts(bar, time)
        return (
          <div key={b} className="flex items-end" style={{ marginLeft: b ? z.gap * 3 : 0 }}>
            {bar.map((s, j) => {
              const on = i++ === lit
              return (
                <div
                  key={j}
                  className={clsx('flex flex-col items-center gap-[3px] rounded-lg', z.count && 'py-1', on && 'bg-glow text-glow-ink')}
                  style={{ width: z.cell, marginLeft: counts[j].beat && j ? z.gap : 0 }}
                >
                  <span className="flex items-center justify-center" style={{ width: z.arrow, height: z.arrow }}>
                    <StrokeGlyph stroke={s} size={z.arrow} dot={z.dot} on={on} />
                  </span>
                  {z.count && (
                    <span className={clsx('font-extrabold leading-none', z.count, on ? '' : counts[j].beat ? 'text-ink-soft' : 'text-ink-faint')}>
                      {counts[j].count}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

/** One stroke's mark: an arrow, a chuck's cross, or a miss's dot. */
export function StrokeGlyph({ stroke, size, dot, on }: { stroke: Stroke; size: number; dot: string; on: boolean }) {
  if (stroke.kind === 'miss') return <span className={clsx('rounded-full', dot, on ? 'bg-glow-ink' : 'bg-ink-faint/70')} />
  const color = on ? 'text-glow-ink' : stroke.accent ? 'text-chord' : 'text-ink'
  const width = stroke.accent ? 3.2 : 2.3
  if (stroke.kind === 'chuck')
    return (
      <svg width={size * 0.8} height={size * 0.8} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" className={on ? 'text-glow-ink' : 'text-ink-soft'} aria-hidden>
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
    )
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" className={color} aria-hidden>
      {stroke.kind === 'down' ? (
        <>
          <path d="M12 3v17" />
          <path d="M5.5 13.5 12 20l6.5-6.5" />
        </>
      ) : (
        <>
          <path d="M12 21V4" />
          <path d="M5.5 10.5 12 4l6.5 6.5" />
        </>
      )}
    </svg>
  )
}

/** A pattern's display name: "Chorus", or "Strum" for the sheet's unnamed one. */
export function strumName(name: string | null): string {
  return name ? name[0].toUpperCase() + name.slice(1) : 'Strum'
}

/**
 * Where the pattern changes: beside a section's label, or on its own line
 * mid-section. A one-bar "once" is marked in the chord color.
 */
export function StrumChip({ change, time, note, className }: { change: StrumChange; time?: string; note?: string; className?: string }) {
  const label = change.once ? 'once' : change.name ? `${change.name} strum` : 'strum'
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-2 rounded-xl px-2.5 py-0.5 text-[0.7rem] font-extrabold text-ink-soft',
        change.once ? 'border-2 border-chord' : 'bg-surface',
        className,
      )}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-glow" aria-hidden>
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
      <span>{label}</span>
      <StrumStrip pattern={change.pattern} time={time} size="xs" />
      {note && <span className="font-bold">{note}</span>}
    </span>
  )
}

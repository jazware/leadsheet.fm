import { useState } from 'react'
import { clsx } from 'clsx'
import { Star } from 'lucide-react'

/** Read-only average, e.g. in lists. */
export function StarsShown({ avg, count, className }: { avg: number; count: number; className?: string }) {
  if (!count) return <span className={clsx('text-sm font-bold text-ink-soft', className)}>new</span>
  return (
    <span
      className={clsx('inline-flex items-center gap-1 text-sm font-bold text-ink-soft', className)}
      title={`${avg.toFixed(1)} out of 5 from ${count} rating${count === 1 ? '' : 's'}`}
    >
      <Star className="h-3.5 w-3.5 fill-chord text-chord" aria-hidden />
      <span className="font-extrabold text-ink">{avg.toFixed(1)}</span>
      <span>({count})</span>
    </span>
  )
}

/** The viewer's own rating; clicking the current value clears it. */
export function StarsInput({
  value,
  onChange,
  disabled,
}: {
  value: number
  onChange: (v: number) => void
  disabled?: boolean
}) {
  const [hover, setHover] = useState(0)
  const shown = hover || value
  return (
    <div className="flex" role="radiogroup" aria-label="Your rating" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          disabled={disabled}
          onMouseEnter={() => setHover(n)}
          onClick={() => onChange(value === n ? 0 : n)}
          className="flex h-9 w-8 items-center justify-center disabled:opacity-50"
        >
          <Star className={clsx('h-6 w-6 text-chord', n <= shown ? 'fill-chord' : 'fill-transparent opacity-60')} />
        </button>
      ))}
    </div>
  )
}

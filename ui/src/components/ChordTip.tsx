import { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { ChordDiagram } from '@/components/ChordDiagram'
import { mod12, simplifyQuality, type ChordSymbol } from '@/lib/music'
import { STANDARD_STRINGS } from '@/lib/tunings'

/**
 * Whether chord names in a sheet show their shape on hover, and for which
 * tuning. Off for ukulele and bass sheets (the boxes are guitar shapes).
 */
export const ChordTipContext = createContext<{ strings: number[] } | null>({ strings: STANDARD_STRINGS })

/**
 * A chord name that shows its chord box on hover or focus, and on tap for
 * touch screens. `chord` is as written; `shift` and `simplify` are applied
 * the same way as to the label.
 */
export function ChordTip({
  chord,
  label,
  shift,
  flats,
  simplify,
  className,
}: {
  chord: ChordSymbol
  label: string
  shift: number
  flats: boolean
  simplify: boolean
  className?: string
}) {
  const ctx = useContext(ChordTipContext)
  const [open, setOpen] = useState(false)
  const [below, setBelow] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const id = useId()

  // A tap elsewhere closes a tapped-open tip.
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  if (!ctx) return <span className={className}>{label}</span>

  const show = () => {
    // Flip below the chord when there isn't room above it.
    setBelow((ref.current?.getBoundingClientRect().top ?? 999) < 150)
    setOpen(true)
  }
  const shown = {
    ...chord,
    root: mod12(chord.root + shift),
    quality: simplify && chord.quality ? simplifyQuality(chord.quality) : chord.quality,
  }

  return (
    <button
      ref={ref}
      type="button"
      className={clsx('relative cursor-help rounded-sm text-left focus-visible:ring-offset-0', className)}
      aria-describedby={open ? id : undefined}
      onMouseEnter={show}
      onMouseLeave={() => setOpen(false)}
      onFocus={show}
      onBlur={() => setOpen(false)}
      onClick={() => (open ? setOpen(false) : show())}
    >
      {label}
      {open && (
        <span
          id={id}
          role="tooltip"
          className={clsx(
            'pointer-events-none absolute left-1/2 z-40 -translate-x-1/2 rounded-2xl border border-rule bg-surface-raised p-1 text-base shadow-float',
            below ? 'top-full mt-2' : 'bottom-full mb-2',
          )}
        >
          <ChordDiagram chord={shown} label={label} flats={flats} strings={ctx.strings} />
        </span>
      )}
    </button>
  )
}

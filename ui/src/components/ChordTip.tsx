import { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { ChordDiagram } from '@/components/ChordDiagram'
import { useVoicing } from '@/components/Voicings'
import { mod12, simplifyQuality, type ChordSymbol } from '@/lib/music'
import { STANDARD_STRINGS } from '@/lib/tunings'

/**
 * Whether chord names in a sheet show their shape on hover, and for which
 * tuning. Off for ukulele and bass sheets (the boxes are guitar shapes).
 */
export const ChordTipContext = createContext<{ strings: number[] } | null>({ strings: STANDARD_STRINGS })

/**
 * A chord name that shows its chord box on hover or focus, and on tap for
 * touch screens. The box's arrows (or ←/→ while the name has focus) step
 * through other voicings; the pick sticks for that chord everywhere.
 * `chord` is as written; `shift` and `simplify` are applied the same way
 * as to the label.
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
  const wrap = useRef<HTMLSpanElement>(null)
  const id = useId()
  const shown = {
    ...chord,
    root: mod12(chord.root + shift),
    quality: simplify && chord.quality ? simplifyQuality(chord.quality) : chord.quality,
  }
  const { step } = useVoicing(shown.quality ? { root: shown.root, quality: shown.quality } : null, ctx?.strings ?? STANDARD_STRINGS)

  // A tap elsewhere closes a tapped-open tip.
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  if (!ctx) return <span className={className}>{label}</span>

  const show = () => {
    // Flip below the chord when there isn't room above it.
    setBelow((wrap.current?.getBoundingClientRect().top ?? 999) < 190)
    setOpen(true)
  }

  return (
    <span ref={wrap} className="relative inline-block" onMouseEnter={show} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className={clsx('cursor-help rounded-sm text-left focus-visible:ring-offset-0', className)}
        aria-describedby={open ? id : undefined}
        onFocus={show}
        onBlur={(e) => {
          if (!wrap.current?.contains(e.relatedTarget as Node)) setOpen(false)
        }}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => {
          if (!open || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
          e.preventDefault()
          step(e.key === 'ArrowRight' ? 1 : -1)
        }}
      >
        {label}
      </button>
      {open && (
        // The padding bridges the gap to the chord name, so the pointer can
        // travel into the box (to its arrows) without closing it.
        <span
          id={id}
          role="tooltip"
          className={clsx('absolute left-1/2 z-40 -translate-x-1/2', below ? 'top-full pt-2' : 'bottom-full pb-2')}
        >
          <span className="block rounded-2xl border border-rule bg-surface-raised p-1 text-base text-ink shadow-float">
            <ChordDiagram chord={shown} label={label} flats={flats} strings={ctx.strings} cycle />
          </span>
        </span>
      )}
    </span>
  )
}

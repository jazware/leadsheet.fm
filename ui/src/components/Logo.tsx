import { Link } from 'react-router-dom'
import { clsx } from 'clsx'

export function Sparkle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={clsx('fill-chord', className)} aria-hidden>
      <path d="M12 2l2 8 8 2-8 2-2 8-2-8-8-2 8-2z" />
    </svg>
  )
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" className={clsx('inline-flex items-center gap-1.5 text-2xl font-black tracking-tight text-ink', className)}>
      leadsheet
      <Sparkle className="h-4 w-4" />
    </Link>
  )
}

import { clsx } from 'clsx'
import { Search } from 'lucide-react'

/** The pill-shaped search box used on home, in the header, and on /search. */
export function SearchField({
  value,
  onChange,
  onSubmit,
  autoFocus,
  size = 'md',
  className,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit?: () => void
  autoFocus?: boolean
  size?: 'md' | 'lg'
  className?: string
}) {
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit?.()
      }}
      className={clsx(
        'flex min-w-0 items-center gap-2.5 rounded-full bg-surface px-4 focus-within:ring-2 focus-within:ring-chord',
        size === 'lg' ? 'h-14' : 'h-11',
        className,
      )}
    >
      <Search className={clsx('shrink-0 text-ink-soft', size === 'lg' ? 'h-5 w-5' : 'h-4 w-4')} aria-hidden />
      <input
        type="search"
        aria-label="Search songs, artists, lyrics"
        placeholder="Song, artist or a lyric"
        className={clsx(
          'min-w-0 flex-1 bg-transparent font-bold text-ink placeholder:font-semibold placeholder:text-ink-faint focus:outline-none',
          size === 'lg' ? 'text-[1.1rem]' : 'text-[0.95rem]',
        )}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        enterKeyHint="search"
      />
    </form>
  )
}

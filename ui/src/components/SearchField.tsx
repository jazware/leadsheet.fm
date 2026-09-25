import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { Search } from 'lucide-react'
import { api, sheetPath, type SongResult } from '@/lib/api'
import { Snippet } from '@/components/Snippet'

const SUGGESTIONS = 6
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** Where a search result goes: the sheet when there's one version, else the song. */
export const songPath = (s: SongResult) => (s.versionCount === 1 ? sheetPath(s.top) : `/songs/${s.artistSlug}/${s.titleSlug}`)

/**
 * The pill-shaped search box used on home, in the header, and on /search.
 * With `suggest`, songs matching what's typed drop down under it (arrow
 * keys pick, Enter opens, Esc closes). ⌘K / Ctrl+K focuses it from
 * anywhere (see useSearchShortcut).
 */
export function SearchField({
  value,
  onChange,
  onSubmit,
  autoFocus,
  suggest,
  size = 'md',
  className,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit?: () => void
  autoFocus?: boolean
  suggest?: boolean
  size?: 'md' | 'lg'
  className?: string
}) {
  const navigate = useNavigate()
  const listId = useId()
  const [focused, setFocused] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [typed, setTyped] = useState(value.trim())

  // Ask once typing pauses.
  useEffect(() => {
    const t = setTimeout(() => setTyped(value.trim()), 140)
    return () => clearTimeout(t)
  }, [value])
  const { data } = useQuery({
    queryKey: ['suggest', typed],
    queryFn: () => api.search(typed, SUGGESTIONS),
    enabled: !!suggest && typed.length >= 2,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  })
  const songs = suggest && value.trim().length >= 2 ? data?.songs ?? [] : []
  const showing = open && focused && songs.length > 0
  // Rows: the songs, then "search for …".
  const rows = songs.length + 1

  useEffect(() => setActive(-1), [typed])

  const go = (to: string) => {
    setOpen(false)
    onChange('') // the header box shouldn't keep a search that's been answered
    ;(document.activeElement as HTMLElement | null)?.blur()
    navigate(to)
  }
  const choose = (i: number) => (i >= 0 && i < songs.length ? go(songPath(songs[i])) : onSubmit?.())

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        if (showing && active >= 0) choose(active)
        else {
          setOpen(false)
          onSubmit?.()
        }
      }}
      className={clsx('relative', className)}
    >
      <div
        className={clsx(
          'flex min-w-0 items-center gap-2.5 rounded-full bg-surface px-4 focus-within:ring-2 focus-within:ring-chord',
          size === 'lg' ? 'h-14' : 'h-11',
        )}
      >
        <Search className={clsx('shrink-0 text-ink-soft', size === 'lg' ? 'h-5 w-5' : 'h-4 w-4')} aria-hidden />
        <input
          type="search"
          data-search
          aria-label="Search songs, artists, lyrics"
          placeholder="Song, artist or a lyric"
          className={clsx(
            // The pill around it shows focus; the global focus ring would draw a second one.
            'min-w-0 flex-1 bg-transparent font-bold text-ink placeholder:font-semibold placeholder:text-ink-faint focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
            size === 'lg' ? 'text-[1.1rem]' : 'text-[0.95rem]',
          )}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => {
            setFocused(true)
            setOpen(true)
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              if (showing) setOpen(false)
              else e.currentTarget.blur()
              return
            }
            if (!showing || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
            e.preventDefault()
            setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % rows : (a - 1 + rows) % rows))
          }}
          autoFocus={autoFocus}
          enterKeyHint="search"
          autoComplete="off"
          {...(suggest && {
            role: 'combobox',
            'aria-autocomplete': 'list' as const,
            'aria-expanded': showing,
            'aria-controls': listId,
            'aria-activedescendant': showing && active >= 0 ? `${listId}-${active}` : undefined,
          })}
        />
        {!focused && !value && (
          <kbd className="hidden shrink-0 rounded-md border border-rule px-1.5 font-sans text-xs font-bold text-ink-faint sm:block" aria-hidden>
            {isMac ? '⌘K' : 'Ctrl K'}
          </kbd>
        )}
      </div>
      {showing && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Suggestions"
          className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-[20px] border border-rule bg-surface-raised py-1.5 shadow-float"
        >
          {songs.map((s, i) => (
            <li
              key={`${s.artistSlug}/${s.titleSlug}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={active === i}
              className={clsx('flex cursor-pointer flex-col px-4 py-2', active === i && 'bg-surface')}
              // mousedown, not click: the input's blur would close the list first.
              onMouseDown={(e) => {
                e.preventDefault()
                choose(i)
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-extrabold">
                  {s.title}
                  <span className="font-bold text-ink-soft"> by {s.artist}</span>
                </span>
                {s.versionCount > 1 && <span className="shrink-0 text-xs font-bold text-ink-faint">{s.versionCount} versions</span>}
              </span>
              {s.snippet && (
                <span className="truncate text-sm text-ink-soft">
                  <Snippet text={s.snippet} />
                </span>
              )}
            </li>
          ))}
          <li
            id={`${listId}-${songs.length}`}
            role="option"
            aria-selected={active === songs.length}
            className={clsx('cursor-pointer px-4 py-2 text-sm font-bold text-ink-soft', active === songs.length && 'bg-surface')}
            onMouseDown={(e) => {
              e.preventDefault()
              choose(songs.length)
            }}
            onMouseEnter={() => setActive(songs.length)}
          >
            Search for “{value.trim()}”
          </li>
        </ul>
      )}
    </form>
  )
}

/**
 * ⌘K / Ctrl+K (or "/" when not typing) focuses the search box on screen,
 * or opens the search page when there isn't one.
 */
export function useSearchShortcut() {
  const navigate = useNavigate()
  const latest = useRef(navigate)
  latest.current = navigate
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))
      const combo = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k'
      if (!combo && !(e.key === '/' && !typing && !e.metaKey && !e.ctrlKey)) return
      // Not over a full-screen dialog (stage mode): the box behind it isn't reachable.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
      e.preventDefault()
      const box = [...document.querySelectorAll<HTMLInputElement>('input[data-search]')].find((el) => el.offsetParent !== null)
      if (box) {
        box.focus()
        box.select()
      } else latest.current('/search')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

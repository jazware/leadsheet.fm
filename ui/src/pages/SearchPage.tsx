import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { KIND_LABEL, sheetPath, type SongResult } from '@/lib/api'
import { useSearch } from '@/hooks/queries'
import { StarsShown } from '@/components/Stars'
import { SearchField } from '@/components/SearchField'
import { useTitle } from '@/hooks/useTitle'

export function SearchPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const q = params.get('q') ?? ''
  const { data, error } = useSearch(q)
  useTitle(q.trim() ? `Search: ${q.trim()}` : 'Search')

  return (
    <div className="flex flex-col gap-4 pt-1">
      <div className="flex items-center gap-2.5">
        <button type="button" className="btn px-0" aria-label="Back" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </button>
        <SearchField
          size="lg"
          className="flex-1"
          value={q}
          autoFocus={!q}
          onChange={(v) => navigate(`/search?q=${encodeURIComponent(v)}`, { replace: true })}
        />
      </div>
      {error && <p className="font-bold text-chord">{error.message}</p>}
      {q.trim() && data && (
        <>
          <p className="text-sm font-bold text-ink-soft">
            {data.songs.length} {data.songs.length === 1 ? 'song' : 'songs'}
          </p>
          {data.songs.length ? (
            <ul className="flex flex-col gap-2.5">
              {data.songs.map((s) => (
                <SongRow key={`${s.artistSlug}/${s.titleSlug}`} song={s} />
              ))}
            </ul>
          ) : (
            <p className="max-w-prose font-semibold">
              Nothing matches that yet. Check the spelling, try fewer words, or{' '}
              <Link to="/new" className="text-chord underline">
                write the sheet yourself
              </Link>
              .
            </p>
          )}
        </>
      )}
    </div>
  )
}

/** Renders a search snippet, marking the matched words. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\u0002[^\u0003]*\u0003)/)
  return (
    <span className="line-clamp-2 font-semibold italic">
      “
      {parts.map((p, i) => (p.startsWith('\u0002') ? <mark key={i}>{p.slice(1, -1)}</mark> : <span key={i}>{p.replace(/\n+/g, ' / ')}</span>))}
      ”
    </span>
  )
}

export function SongRow({ song, showArtist = true }: { song: SongResult; showArtist?: boolean }) {
  const to = song.versionCount === 1 ? sheetPath(song.top) : `/songs/${song.artistSlug}/${song.titleSlug}`
  const kinds = song.kinds.map((k) => (KIND_LABEL[k] ?? k).toLowerCase()).join(', ')
  return (
    <li>
      <Link to={to} className="card flex flex-col gap-1.5 px-4 py-3.5 hover:bg-surface-raised">
        <span className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-[1.05rem] font-extrabold">
            {song.title}
            {showArtist && <span className="font-bold text-ink-soft"> by {song.artist}</span>}
          </span>
          <StarsShown avg={song.top.stats.ratingAvg} count={song.top.stats.ratingCount} className="shrink-0" />
        </span>
        <span className="text-sm font-semibold text-ink-soft">
          {song.versionCount} {song.versionCount === 1 ? 'version' : 'versions'}: {kinds}
        </span>
        {song.snippet && <Snippet text={song.snippet} />}
      </Link>
    </li>
  )
}

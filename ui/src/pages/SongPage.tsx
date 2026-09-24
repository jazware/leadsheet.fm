import { Link, useParams } from 'react-router-dom'
import { GitFork, Plus } from 'lucide-react'
import { sheetPath } from '@/lib/api'
import { useSong } from '@/hooks/queries'
import { StarsShown } from '@/components/Stars'
import { handleText } from '@/components/Author'
import { sheetMeta } from '@/components/SheetList'
import { Sparkle } from '@/components/Logo'
import { useTitle } from '@/hooks/useTitle'

export function SongPage() {
  const { artist = '', title = '' } = useParams()
  const { data, error, isLoading } = useSong(artist, title)
  useTitle(data && `${data.title} by ${data.artist}`)
  if (isLoading) return <p className="font-semibold text-ink-soft">Loading…</p>
  if (error || !data) return <p className="font-bold">{error?.message ?? 'Song not found'}</p>

  const versionOf = (uri: string) => data.versions.find((v) => v.uri === uri)?.version
  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div>
        <h1 className="text-4xl font-black leading-tight tracking-tight">{data.title}</h1>
        <Link to={`/artists/${data.artistSlug}`} className="mt-1 inline-block text-lg font-bold text-ink-soft hover:underline">
          {data.artist}
        </Link>
      </div>
      <ul className="flex flex-col gap-2.5">
        {data.versions.map((v, i) => (
          <li key={v.uri}>
            <Link to={sheetPath(v)} className="card flex flex-col gap-2 p-4 hover:bg-surface-raised">
              <span className="flex items-center justify-between gap-3">
                <span className="text-[1.05rem] font-black">
                  Version {v.version} <span className="font-bold text-ink-soft">by {handleText(v.author)}</span>
                </span>
                <StarsShown avg={v.stats.ratingAvg} count={v.stats.ratingCount} />
              </span>
              <span className="text-sm font-semibold text-ink-soft">
                {sheetMeta(v)}
                {v.difficulty && `, ${v.difficulty}`}
              </span>
              {((i === 0 && v.stats.ratingCount > 0 && data.versions.length > 1) || v.forkOf) && (
                <span className="flex flex-wrap items-center gap-2">
                  {i === 0 && v.stats.ratingCount > 0 && data.versions.length > 1 && (
                    <span className="pill bg-chord text-bg">
                      <Sparkle className="h-3 w-3 fill-bg" /> Top rated
                    </span>
                  )}
                  {v.forkOf && (
                    <span className="inline-flex items-center gap-1 text-sm font-bold text-ink-soft">
                      <GitFork className="h-3.5 w-3.5" aria-hidden />
                      {versionOf(v.forkOf.uri) ? `fork of version ${versionOf(v.forkOf.uri)}` : 'a fork'}
                    </span>
                  )}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
      <Link to="/new" className="btn border-2 border-rule bg-transparent">
        <Plus className="h-4 w-4" aria-hidden /> Write your own version
      </Link>
    </div>
  )
}

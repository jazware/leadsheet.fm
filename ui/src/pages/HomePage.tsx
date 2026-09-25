import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import { sheetPath } from '@/lib/api'
import { recentSheets } from '@/lib/recent'
import { pretty } from '@/lib/music'
import { useProfile, useSheets, useViewer } from '@/hooks/queries'
import { SheetList } from '@/components/SheetList'
import { SearchField } from '@/components/SearchField'

export function HomePage() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<'recent' | 'top'>('recent')
  const recent = useSheets('recent')
  const top = useSheets('top')
  const list = tab === 'recent' ? recent : top

  return (
    <div className="flex flex-col gap-7 pt-1">
      <SearchField
        suggest
        size="lg"
        value={q}
        onChange={setQ}
        onSubmit={() => q.trim() && navigate(`/search?q=${encodeURIComponent(q.trim())}`)}
      />
      <KeepPlaying />
      <section className="flex flex-col gap-3">
        <div role="tablist" aria-label="Sheets" className="flex w-max gap-1 rounded-full bg-surface p-1">
          {(
            [
              ['recent', 'New'],
              ['top', 'Top rated'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={clsx(
                'h-9 rounded-full px-4 text-sm font-extrabold',
                tab === k ? 'bg-ink text-bg' : 'text-ink-soft hover:text-ink',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {list.data ? (
          <SheetList
            sheets={list.data.pages.flatMap((p) => p.sheets)}
            empty={
              tab === 'recent' ? (
                <>
                  No sheets yet.{' '}
                  <Link to="/new" className="text-chord underline">
                    Yours could be the first.
                  </Link>
                </>
              ) : (
                "Nothing's rated yet. Open a sheet you've played and give it some stars."
              )
            }
          />
        ) : (
          <p className="font-semibold text-ink-soft">Loading…</p>
        )}
        {list.hasNextPage && (
          <button type="button" className="btn w-max self-center" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
            {list.isFetchingNextPage ? 'Loading…' : 'Show more'}
          </button>
        )}
      </section>
    </div>
  )
}

/** Songs opened in this browser, then the viewer's saved ones. */
function KeepPlaying() {
  const viewer = useViewer()
  const saved = useProfile(viewer?.did ?? '')
  const items = useMemo(() => {
    const seen = new Set<string>()
    const out: { did: string; rkey: string; handle: string; title: string; key: string; note: string }[] = []
    for (const r of recentSheets()) {
      seen.add(`${r.did}/${r.rkey}`)
      out.push({ ...r, note: r.capo ? `capo ${r.capo}` : 'played recently' })
    }
    for (const s of viewer ? saved.data?.favorites ?? [] : []) {
      if (seen.has(`${s.did}/${s.rkey}`)) continue
      out.push({ did: s.did, rkey: s.rkey, handle: s.author.handle, title: s.title, key: s.key, note: 'saved' })
    }
    return out.slice(0, 10)
  }, [viewer, saved.data])

  if (!items.length) return null
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="text-sm font-extrabold text-ink-soft">Keep playing</h2>
      <div className="-mx-5 flex gap-2.5 overflow-x-auto px-5 pb-1 sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0">
        {items.map((s) => (
          <Link
            key={`${s.did}/${s.rkey}`}
            to={sheetPath({ did: s.did, rkey: s.rkey, author: { did: s.did, handle: s.handle, displayName: '', avatar: '' } })}
            className="card flex w-36 shrink-0 flex-col gap-3 p-3.5 hover:bg-surface-raised sm:w-auto"
          >
            <span className="text-2xl font-black leading-none text-chord">{s.key ? pretty(s.key) : '♪'}</span>
            <span className="line-clamp-2 font-extrabold leading-tight">{s.title}</span>
            <span className="text-xs font-bold text-ink-soft">{s.note}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}

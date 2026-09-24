import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { clsx } from 'clsx'
import { useProfile, useViewer } from '@/hooks/queries'
import { Avatar, handleText } from '@/components/Author'
import { SheetList } from '@/components/SheetList'
import { useTitle } from '@/hooks/useTitle'

export function ProfilePage() {
  const { actor = '' } = useParams()
  const { data, error, isLoading } = useProfile(actor)
  useTitle(data && (data.author.displayName || `@${data.author.handle}`))
  const viewer = useViewer()
  const [tab, setTab] = useState<'sheets' | 'favorites'>('sheets')
  if (isLoading) return <p className="font-semibold text-ink-soft">Loading…</p>
  if (error || !data) return <p className="font-bold">{error?.message ?? 'Account not found'}</p>

  const { author } = data
  const me = viewer?.did === author.did
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-center gap-4">
        <Avatar author={author} size="lg" />
        <div>
          <h1 className="text-3xl font-black tracking-tight">{author.displayName || handleText(author)}</h1>
          {author.displayName && <p className="font-bold text-ink-soft">{handleText(author)}</p>}
        </div>
      </div>
      <div role="tablist" className="flex w-max gap-1 rounded-full bg-surface p-1">
        {(['sheets', 'favorites'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={clsx('h-9 rounded-full px-4 text-sm font-extrabold', tab === t ? 'bg-ink text-bg' : 'text-ink-soft hover:text-ink')}
          >
            {t === 'sheets' ? 'Sheets' : 'Saved'} <span className="opacity-70">{data[t].length}</span>
          </button>
        ))}
      </div>
      {tab === 'sheets' ? (
        <SheetList sheets={data.sheets} empty={me ? 'You haven’t published a sheet yet.' : 'No sheets yet.'} />
      ) : (
        <SheetList sheets={data.favorites} empty={me ? 'Sheets you save show up here.' : 'Nothing saved yet.'} />
      )}
    </div>
  )
}

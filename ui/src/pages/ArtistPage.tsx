import { useParams } from 'react-router-dom'
import { useArtist } from '@/hooks/queries'
import { SongRow } from '@/pages/SearchPage'
import { useTitle } from '@/hooks/useTitle'

export function ArtistPage() {
  const { artist = '' } = useParams()
  const { data, error, isLoading } = useArtist(artist)
  useTitle(data?.name)
  if (isLoading) return <p className="font-semibold text-ink-soft">Loading…</p>
  if (error || !data) return <p className="font-bold">{error?.message ?? 'Artist not found'}</p>

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div>
        <h1 className="text-4xl font-black leading-tight tracking-tight">{data.name}</h1>
        <p className="mt-1 font-bold text-ink-soft">
          {data.songs.length} {data.songs.length === 1 ? 'song' : 'songs'}
        </p>
      </div>
      <ul className="flex flex-col gap-2.5">
        {data.songs.map((s) => (
          <SongRow key={s.titleSlug} song={s} showArtist={false} />
        ))}
      </ul>
    </div>
  )
}

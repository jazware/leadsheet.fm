import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type SheetPage } from '@/lib/api'

export const useSession = () =>
  useQuery({ queryKey: ['session'], queryFn: api.session, staleTime: 60_000 })

export const useViewer = () => useSession().data?.viewer ?? null

export const useSheets = (sort: 'recent' | 'top') =>
  useQuery({ queryKey: ['sheets', sort], queryFn: () => api.listSheets(sort) })

export const useSheet = (actor: string, rkey: string) =>
  useQuery({ queryKey: ['sheet', actor, rkey], queryFn: () => api.sheet(actor, rkey) })

export const useSearch = (q: string) =>
  useQuery({
    queryKey: ['search', q],
    queryFn: () => api.search(q),
    enabled: q.trim().length > 0,
    placeholderData: (prev) => prev,
  })

export const useSong = (artist: string, title: string) =>
  useQuery({ queryKey: ['song', artist, title], queryFn: () => api.song(artist, title) })

export const useArtist = (artist: string) =>
  useQuery({ queryKey: ['artist', artist], queryFn: () => api.artist(artist) })

export const useProfile = (actor: string) =>
  useQuery({ queryKey: ['profile', actor], queryFn: () => api.profile(actor), enabled: !!actor })

/** Rating and favoriting patch the cached sheet page with the server's answer. */
export function useSheetActions(actor: string, rkey: string, did: string) {
  const qc = useQueryClient()
  const patch = (res: Pick<SheetPage, 'viewer'> & { stats: SheetPage['sheet']['stats'] }) => {
    qc.setQueryData<SheetPage>(['sheet', actor, rkey], (old) =>
      old && { ...old, viewer: res.viewer, sheet: { ...old.sheet, stats: res.stats } },
    )
    qc.invalidateQueries({ queryKey: ['profile'] })
    qc.invalidateQueries({ queryKey: ['sheets'] })
  }
  const rate = useMutation({ mutationFn: (value: number) => api.rate(did, rkey, value), onSuccess: patch })
  const favorite = useMutation({
    mutationFn: (fav: boolean) => api.favorite(did, rkey, fav),
    onSuccess: patch,
  })
  return { rate, favorite }
}

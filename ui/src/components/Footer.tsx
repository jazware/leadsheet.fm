import { useQuery } from '@tanstack/react-query'
import { Star } from 'lucide-react'
import { api } from '@/lib/api'
import { Sparkle } from '@/components/Logo'

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

/** Site footer: what Leadsheet is, and where its code lives. */
export function Footer() {
  const { data } = useQuery({ queryKey: ['about'], queryFn: api.about, staleTime: 10 * 60_000 })
  const repo = data?.repo ?? 'jazware/leadsheet.fm'
  const url = data?.repoUrl ?? `https://github.com/${repo}`

  return (
    <footer className="no-print mt-16 flex flex-col items-start justify-between gap-4 border-t border-rule pt-6 sm:flex-row sm:items-center">
      <p className="flex items-center gap-2 text-sm font-semibold text-ink-soft">
        <Sparkle className="h-3.5 w-3.5 shrink-0" />
        <span>
          Open-source chord sheets on atproto. Follow{' '}
          <a href="https://bsky.app/profile/leadsheet.fm" className="font-extrabold text-ink hover:underline">
            @leadsheet.fm
          </a>
          .
        </span>
      </p>
      <a
        href={url}
        className="group inline-flex h-9 items-stretch overflow-hidden rounded-full bg-surface text-sm font-extrabold hover:bg-surface-raised"
        aria-label={`Leadsheet's source code on GitHub, ${repo}${data?.stars != null ? `, ${data.stars} stars` : ''}`}
      >
        <span className="flex items-center gap-2 px-3.5">
          <GitHubMark className="h-4 w-4" />
          {repo}
        </span>
        {data?.stars != null && (
          <span className="flex items-center gap-1 border-l border-bg px-3 text-ink-soft group-hover:text-ink">
            <Star className="h-3.5 w-3.5 fill-chord text-chord" aria-hidden />
            {data.stars > 0 ? data.stars : 'Star'}
          </span>
        )}
      </a>
    </footer>
  )
}

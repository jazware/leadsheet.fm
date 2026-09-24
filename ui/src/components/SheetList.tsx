import { Link } from 'react-router-dom'
import { GitFork } from 'lucide-react'
import { KIND_LABEL, sheetPath, type SheetSummary } from '@/lib/api'
import { StarsShown } from '@/components/Stars'
import { handleText } from '@/components/Author'

export function sheetMeta(s: SheetSummary, lower = false) {
  const kind = KIND_LABEL[s.kind] ?? s.kind
  const parts = [lower ? kind.toLowerCase() : kind]
  if (s.key) parts.push(`key of ${s.key}`)
  if (s.capo > 0) parts.push(`capo ${s.capo}`)
  return parts.join(', ')
}

/** Sheets as rounded cards: song first, then what kind and how it rates. */
export function SheetList({
  sheets,
  showSong = true,
  version,
  empty,
}: {
  sheets: SheetSummary[]
  showSong?: boolean
  /** Label for each card instead of the song, e.g. "Version 2". */
  version?: (s: SheetSummary) => string
  empty?: React.ReactNode
}) {
  if (!sheets.length) return <p className="py-3 font-semibold text-ink-soft">{empty}</p>
  return (
    <ul className="flex flex-col gap-2.5">
      {sheets.map((s) => (
        <li key={s.uri}>
          <Link to={sheetPath(s)} className="card flex items-center gap-3 px-4 py-3.5 hover:bg-surface-raised">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[1.05rem] font-extrabold">
                {showSong ? s.title : version?.(s) ?? s.title}
                {!showSong && <span className="font-bold text-ink-soft"> by {handleText(s.author)}</span>}
              </div>
              <div className="truncate text-sm font-semibold text-ink-soft">
                {showSong && <>{s.artist}, </>}
                {sheetMeta(s, showSong)}
                {s.forkOf && <GitFork className="ml-1.5 inline h-3.5 w-3.5" aria-label="fork" />}
              </div>
            </div>
            <StarsShown avg={s.stats.ratingAvg} count={s.stats.ratingCount} className="shrink-0" />
          </Link>
        </li>
      ))}
    </ul>
  )
}

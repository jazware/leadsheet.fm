import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Bookmark } from 'lucide-react'
import { bookmarklet } from '@/lib/ultimateGuitar'
import { Sparkle } from '@/components/Logo'
import { useTitle } from '@/hooks/useTitle'

/** How to bring sheets over from Ultimate Guitar. */
export function ImportPage() {
  const link = useRef<HTMLAnchorElement>(null)
  useTitle('Import from Ultimate Guitar')
  // React refuses javascript: URLs in href, so set it on the element.
  useEffect(() => {
    link.current?.setAttribute('href', bookmarklet(window.location.origin))
  }, [])

  return (
    <div className="flex max-w-2xl flex-col gap-6 pt-1">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Import from Ultimate Guitar</h1>
        <p className="mt-2 font-semibold text-ink-soft">
          Bring a chords or tab page over as a draft. You check it over and choose whether to publish it; nothing is
          shared until you do.
        </p>
      </div>

      <ol className="flex flex-col gap-4">
        <li className="card flex flex-col gap-3 p-5">
          <span className="font-black">1. Put this button on your bookmarks bar</span>
          <span className="font-semibold text-ink-soft">
            Drag it up there. (No bookmarks bar? Show it with ⌘⇧B on a Mac, Ctrl+Shift+B elsewhere.)
          </span>
          <a
            ref={link}
            className="btn btn-accent w-max cursor-grab"
            onClick={(e) => e.preventDefault()}
            title="Drag me to your bookmarks bar"
          >
            <Bookmark className="h-4 w-4" aria-hidden />
            Send to Leadsheet
          </a>
        </li>
        <li className="card flex flex-col gap-2 p-5">
          <span className="font-black">2. Open a sheet on Ultimate Guitar and click it</span>
          <span className="font-semibold text-ink-soft">
            Any chords, tab or ukulele page. Leadsheet opens in a new tab with the song, key, capo, tuning and chords
            filled in, and credits whoever transcribed it.
          </span>
        </li>
        <li className="card flex flex-col gap-2 p-5">
          <span className="font-black">3. Check it and publish</span>
          <span className="font-semibold text-ink-soft">
            Make sure the chords sit over the right words (the preview shows them), fix anything that's off, and
            publish. If it's someone else's transcription, consider asking them first, or keep the credit in the
            notes.
          </span>
        </li>
      </ol>

      <p className="flex items-center gap-2 font-semibold text-ink-soft">
        <Sparkle className="h-4 w-4 shrink-0" />
        <span>
          You can also paste a sheet straight into the{' '}
          <Link to="/new" className="font-extrabold text-chord hover:underline">
            editor
          </Link>
          . Chords written above the lyrics, or copied in Ultimate Guitar's own format, get converted for you.
        </span>
      </p>
    </div>
  )
}

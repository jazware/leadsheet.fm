import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '@/lib/api'
import { Sparkle } from '@/components/Logo'

/** Sign in with an atproto account (Bluesky or any PDS) via OAuth. */
export function LoginDialog({ open, onClose, reason }: { open: boolean; onClose: () => void; reason?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  const location = useLocation()
  const [handle, setHandle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { redirect } = await api.login(handle, location.pathname + location.search)
      window.location.href = redirect
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="w-[min(26rem,calc(100vw-2rem))] rounded-[28px] bg-surface p-0 text-ink shadow-float backdrop:bg-black/60"
    >
      <form onSubmit={submit} className="space-y-5 p-6">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-black">
            Sign in <Sparkle className="h-4 w-4" />
          </h2>
          <p className="mt-1.5 font-semibold text-ink-soft">
            {reason ?? 'Your sheets, ratings and saved songs live in your own atproto account.'} Use your Bluesky
            handle or any atproto account.
          </p>
        </div>
        <div>
          <label htmlFor="handle" className="label">
            Handle
          </label>
          <input
            id="handle"
            className="field bg-bg"
            placeholder="you.bsky.social"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            autoFocus
          />
          {error && <p className="mt-2 text-sm font-bold text-chord">{error}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn bg-bg" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-accent" disabled={busy || !handle.trim()}>
            {busy ? 'Opening your PDS…' : 'Continue'}
          </button>
        </div>
      </form>
    </dialog>
  )
}

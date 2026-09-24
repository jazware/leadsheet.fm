import { useCallback, useEffect, useState } from 'react'
import { Link, Route, Routes, useLocation, useMatch, useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { LogOut, Moon, Plus, Sun } from 'lucide-react'
import { api, profilePath } from '@/lib/api'
import { useSession } from '@/hooks/queries'
import { useTheme } from '@/hooks/useTheme'
import { LoginDialog } from '@/components/LoginDialog'
import { LoginContext, useLogin } from '@/components/login'
import { Avatar } from '@/components/Author'
import { Logo } from '@/components/Logo'
import { SearchField } from '@/components/SearchField'
import { HomePage } from '@/pages/HomePage'
import { SearchPage } from '@/pages/SearchPage'
import { SheetPage } from '@/pages/SheetPage'
import { EditorPage } from '@/pages/EditorPage'
import { SongPage } from '@/pages/SongPage'
import { ArtistPage } from '@/pages/ArtistPage'
import { ProfilePage } from '@/pages/ProfilePage'
import { ImportPage } from '@/pages/ImportPage'

export default function App() {
  const [login, setLogin] = useState<{ open: boolean; reason?: string }>({ open: false })
  const openLogin = useCallback((reason?: string) => setLogin({ open: true, reason }), [])
  const [params, setParams] = useSearchParams()
  const loginError = params.get('login_error')
  // Sheets bring their own top bar on phones.
  const onSheet = useMatch('/sheet/:actor/:rkey')

  return (
    <LoginContext.Provider value={openLogin}>
      <div className="mx-auto min-h-screen max-w-6xl px-5 pb-28 sm:px-8">
        <Header className={clsx(onSheet && 'hidden lg:flex')} />
        {loginError && (
          <div className="no-print mb-6 flex items-start justify-between gap-4 rounded-2xl bg-glow px-4 py-3 text-sm font-bold text-glow-ink">
            <span>Sign-in didn't finish: {loginError}</span>
            <button
              type="button"
              className="underline"
              onClick={() => {
                params.delete('login_error')
                setParams(params, { replace: true })
              }}
            >
              Dismiss
            </button>
          </div>
        )}
        <main>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/new" element={<EditorPage />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/sheet/:actor/:rkey" element={<SheetPage />} />
            <Route path="/sheet/:actor/:rkey/edit" element={<EditorPage />} />
            <Route path="/songs/:artist/:title" element={<SongPage />} />
            <Route path="/artists/:artist" element={<ArtistPage />} />
            <Route path="/u/:actor" element={<ProfilePage />} />
            <Route
              path="*"
              element={
                <p className="font-bold">
                  Nothing here.{' '}
                  <Link className="text-chord underline" to="/">
                    Find a song
                  </Link>{' '}
                  instead.
                </p>
              }
            />
          </Routes>
        </main>
      </div>
      <LoginDialog open={login.open} reason={login.reason} onClose={() => setLogin({ open: false })} />
    </LoginContext.Provider>
  )
}

export function ThemeToggle() {
  const [theme, toggle] = useTheme()
  const day = theme === 'day'
  return (
    <button type="button" className="btn px-0" onClick={toggle} aria-label={day ? 'Switch to night colors' : 'Switch to day colors'} title={day ? 'Night colors' : 'Day colors'}>
      {day ? <Moon className="h-5 w-5" aria-hidden /> : <Sun className="h-5 w-5" aria-hidden />}
    </button>
  )
}

function Header({ className }: { className?: string }) {
  const { data } = useSession()
  const viewer = data?.viewer
  const qc = useQueryClient()
  const openLogin = useLogin()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const onSearch = location.pathname === '/search'
  const onHome = location.pathname === '/'
  const [q, setQ] = useState(onSearch ? params.get('q') ?? '' : '')

  useEffect(() => {
    if (!onSearch) setQ('')
  }, [onSearch])

  const signOut = async () => {
    await api.logout()
    qc.invalidateQueries()
  }

  return (
    <header className={clsx('no-print flex flex-wrap items-center gap-x-4 gap-y-3 py-4', className)}>
      <Logo />
      {!onHome && !onSearch && (
        <SearchField
          className="order-last basis-full sm:order-none sm:flex-1 sm:basis-auto"
          value={q}
          onChange={setQ}
          onSubmit={() => q.trim() && navigate(`/search?q=${encodeURIComponent(q.trim())}`)}
        />
      )}
      <nav className="ml-auto flex items-center gap-1.5 sm:gap-2">
        <Link to="/new" className="btn btn-primary px-0 sm:px-4" aria-label="New sheet">
          <Plus className="h-5 w-5 sm:h-4 sm:w-4" aria-hidden />
          <span className="hidden sm:inline">New</span>
        </Link>
        <ThemeToggle />
        {viewer ? (
          <>
            <Link to={profilePath(viewer)} className="rounded-full" aria-label="Your sheets and saved songs" title={`@${viewer.handle}`}>
              <Avatar author={viewer} size="md" />
            </Link>
            <button type="button" className="btn px-0" onClick={signOut} aria-label="Sign out" title="Sign out">
              <LogOut className="h-4 w-4" aria-hidden />
            </button>
          </>
        ) : (
          data && (
            <button type="button" className="btn" onClick={() => openLogin()}>
              Sign in
            </button>
          )
        )}
      </nav>
    </header>
  )
}

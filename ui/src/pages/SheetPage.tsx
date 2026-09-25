import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { clsx } from 'clsx'
import { ArrowLeft, Bookmark, GitFork, Maximize2, Mic, MicOff, Minus, Pause, Pencil, Play, Plus, Printer, Square, Type, Volume2, X } from 'lucide-react'
import { KIND_LABEL, sheetPath, type SheetPage as SheetPageData } from '@/lib/api'
import { chordsIn, parseChordPro, type Segment } from '@/lib/chordpro'
import { keyText, keyUsesFlats, mod12, noteName, parseKey, pretty, simplifyQuality, type Quality } from '@/lib/music'
import { getTuning, instrumentOf, isStandardShapes, shapeStrings } from '@/lib/tunings'
import { rememberSheet } from '@/lib/recent'
import { useSheet, useSheetActions, useViewer } from '@/hooks/queries'
import { usePref } from '@/hooks/usePref'
import { useLogin } from '@/components/login'
import { SheetView, chordLabel, type ViewOptions } from '@/components/SheetView'
import { ChordDiagram } from '@/components/ChordDiagram'
import { ChordTipContext } from '@/components/ChordTip'
import { StarsInput, StarsShown } from '@/components/Stars'
import { AuthorLink, handleText } from '@/components/Author'
import { SheetList } from '@/components/SheetList'
import { fmtDate } from '@/lib/format'
import { useTitle } from '@/hooks/useTitle'
import { usePlayAlong, type PlayAlongState } from '@/listen/usePlayAlong'
import { btcChord } from '@/listen/btc'
import { ChordSoundContext, resolveVoicing, SheetShapesProvider, sheetShapes, usePicks } from '@/components/Voicings'
import { playThrough } from '@/lib/pluck'
import { playAlongChords } from '@/listen/sheet'

export function SheetPage() {
  const { actor = '', rkey = '' } = useParams()
  const { data, error, isLoading } = useSheet(actor, rkey)
  if (isLoading) return <p className="pt-6 font-semibold text-ink-soft">Loading…</p>
  if (error || !data) return <p className="pt-6 font-bold">{error?.message ?? 'Sheet not found'}</p>
  // Keyed by CID so an edited version starts with its own capo and key.
  return <SheetScreen key={data.sheet.cid} page={data} actor={actor} />
}

type Accidentals = 'auto' | 'sharps' | 'flats'

/** Everything the controls change, shared by the rail, the bottom bar and stage mode. */
function useSheetControls(page: SheetPageData) {
  const { sheet } = page
  const doc = useMemo(() => parseChordPro(sheet.content), [sheet.content])
  const chords = useMemo(() => chordsIn(doc), [doc])
  const [transpose, setTranspose] = useState(0)
  const [capo, setCapo] = useState(sheet.capo)
  const [simplify, setSimplify] = useState(false)
  const [accidentals, setAccidentals] = useState<Accidentals>('auto')
  const [fontSize, setFontSize] = usePref('fontSize', 20)
  const [speed, setSpeed] = usePref('scrollSpeed', 3)
  const [scrolling, setScrolling] = useState(false)
  const [stage, setStage] = useState(false)

  const shift = transpose + sheet.capo - capo
  // `key` is the key the chords are written in (shapes, relative to the
  // sheet's capo), which is what authors type.
  const key = parseKey(sheet.key)
  const soundingKey = key && { ...key, tonic: mod12(key.tonic + sheet.capo + transpose) }
  const shapeKey = key && { ...key, tonic: mod12(key.tonic + shift) }
  const flats =
    accidentals === 'auto'
      ? shapeKey
        ? keyUsesFlats(shapeKey)
        : chords.filter((c) => c.flat).length > chords.length / 2
      : accidentals === 'flats'
  const options: ViewOptions = { shift, flats, simplify, fontSize }

  // Play-along expects the chords to sound where the page says (shapes
  // under the sheet's capo, plus any transpose), or failing that as
  // written; it works out anything else from the audio.
  const prior = useMemo(
    () => [
      { offset: sheet.capo + transpose, weight: 1 },
      { offset: transpose, weight: 0.4 },
    ],
    [sheet.capo, transpose],
  )
  const play = usePlayAlong(doc, prior)

  // The author's own chord shapes, while the chords are shown as written
  // (moved, they'd be different shapes).
  const own = useMemo(() => sheetShapes(sheet.voicings), [sheet.voicings])
  const shapes = useMemo(
    () => (shift === 0 && own.size ? { shapes: own, scope: sheet.uri } : null),
    [shift, own, sheet.uri],
  )
  // Chord boxes and the play-through sound as the reader would play them:
  // their capo, the real tuning.
  const tuning = getTuning(sheet.tuning, sheet.kind)
  const instrument = instrumentOf(sheet.kind)
  const sound = useMemo(() => ({ strings: tuning.strings, capo, instrument }), [tuning, capo, instrument])
  // Bass players don't use a capo, so there's no capo control for them.
  const capoable = instrument !== 'bass'

  // Hearing the whole chart: the shapes the boxes show, each chord a bar.
  const picks = usePicks()
  const [bpm, setBpm] = usePref('bpm', 90)
  const [hearing, setHearing] = useState<number | null>(null)
  const stopHearing = useRef<(() => void) | null>(null)
  const sequence = useMemo(() => playAlongChords(doc).segments, [doc])
  const hear = (from = 0, tempo = bpm) => {
    stopHearing.current?.()
    const strings = shapeStrings(tuning)
    const frets = sequence.map((seg) => {
      const c = seg.chord!
      const shown = { ...c, root: mod12(c.root + shift), quality: simplify && c.quality ? simplifyQuality(c.quality) : c.quality }
      return resolveVoicing(shown, strings, shapes, picks)?.frets ?? null
    })
    stopHearing.current = playThrough(frets, sound.strings, sound.capo, tempo, setHearing, () => {
      stopHearing.current = null
      setHearing(null)
    }, from, instrument)
    setHearing(from)
  }
  const silence = () => {
    stopHearing.current?.()
    stopHearing.current = null
    setHearing(null)
  }
  useEffect(() => () => stopHearing.current?.(), [])

  const now = play.state.status === 'listening' ? play.state.now : hearing !== null ? sequence[hearing] ?? null : null

  return {
    doc, chords, options, flats,
    transpose, setTranspose, capo, setCapo, simplify, setSimplify,
    toggleAccidentals: () => setAccidentals(flats ? 'sharps' : 'flats'),
    fontSize, setFontSize, speed, setSpeed, scrolling, setScrolling, stage, setStage,
    soundingKey, shapeKey,
    play, now, shapes, sound, capoable,
    hearing: hearing !== null, bpm,
    toggleHearing: () => {
      if (hearing !== null) return silence()
      play.stop()
      setScrolling(false)
      hear()
    },
    // A new tempo takes over from the chord that's playing.
    stepBpm: (d: number) => {
      const next = Math.max(40, Math.min(200, bpm + d * 5))
      setBpm(next)
      if (hearing !== null) hear(hearing, next)
    },
    togglePlayAlong: () => {
      if (play.active) return play.stop()
      silence()
      setScrolling(false)
      void play.start()
    },
    toggleScrolling: () => {
      if (!scrolling) {
        play.stop()
        silence()
      }
      setScrolling(!scrolling)
    },
    // -5..+6 semitones, wrapping around.
    stepTranspose: (d: number) => setTranspose((t) => ((t + d + 17) % 12) - 5),
    stepCapo: (d: number) => setCapo((c) => Math.max(0, Math.min(12, c + d))),
  }
}
type Controls = ReturnType<typeof useSheetControls>

function SheetScreen({ page, actor }: { page: SheetPageData; actor: string }) {
  const { sheet } = page
  useTitle(`${sheet.title} by ${sheet.artist}`)
  const c = useSheetControls(page)
  const tuning = getTuning(sheet.tuning, sheet.kind)

  useEffect(() => rememberSheet(sheet), [sheet])
  useAutoScroll(c.scrolling && !c.stage, c.speed, null, () => c.setScrolling(false))
  useWakeLock(c.scrolling || c.stage || c.play.active || c.hearing)
  const sheetRef = useRef<HTMLDivElement>(null)
  useFollowScroll(c.now, sheetRef, null, !c.stage)
  const { shapes, sound } = c

  const diagrams = c.chords.length > 0 && (
    <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 lg:mx-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:px-0">
      {c.chords.map((ch, i) => (
        <ChordDiagram
          key={i}
          chord={{
            ...ch,
            root: mod12(ch.root + c.options.shift),
            quality: c.simplify && ch.quality ? simplifyQuality(ch.quality) : ch.quality,
          }}
          label={chordLabel(ch, c.options)}
          flats={c.flats}
          strings={shapeStrings(tuning)}
          cycle
        />
      ))}
    </div>
  )

  return (
    <SheetShapesProvider value={shapes}>
      <ChordSoundContext.Provider value={sound}>
        <article className="grid gap-x-12 gap-y-5 lg:grid-cols-[minmax(0,1fr)_17rem] lg:pt-2">
          <div className="flex min-w-0 flex-col gap-5">
            <TopBar page={page} actor={actor} />
            <TitleBlock page={page} actor={actor} />
            {sheet.description && (
              <p className="card whitespace-pre-line px-4 py-3 font-semibold text-ink-soft">{sheet.description}</p>
            )}
            <div className="no-print lg:hidden">{diagrams}</div>
            <div ref={sheetRef}>
              <ChordTipContext.Provider value={{ strings: shapeStrings(tuning) }}>
                <SheetView doc={c.doc} options={c.options} now={c.now} className="max-w-[40rem] pt-1" />
              </ChordTipContext.Provider>
            </div>
            <Related page={page} />
          </div>
          <aside className="no-print hidden lg:block">
            <div className="card sticky top-4 flex flex-col gap-5 p-5">
              <Rail c={c} />
              {diagrams && (
                <div>
                  <div className="label">
                    Shapes{!isStandardShapes(tuning) && <>, {tuning.name}</>}
                  </div>
                  {diagrams}
                </div>
              )}
            </div>
          </aside>
        </article>
        <BottomBar c={c} />
        {c.stage && <Stage page={page} c={c} />}
      </ChordSoundContext.Provider>
    </SheetShapesProvider>
  )
}

/** Phones: back, and the save/fork/edit actions as icon buttons. */
function TopBar({ page, actor }: { page: SheetPageData; actor: string }) {
  const navigate = useNavigate()
  return (
    <div className="no-print flex items-center justify-between pt-4 lg:hidden">
      <button
        type="button"
        className="btn px-0"
        aria-label="Back"
        onClick={() => (window.history.state?.idx > 0 ? navigate(-1) : navigate('/'))}
      >
        <ArrowLeft className="h-5 w-5" aria-hidden />
      </button>
      <SheetActions page={page} actor={actor} compact />
    </div>
  )
}

function SheetActions({ page, actor, compact }: { page: SheetPageData; actor: string; compact?: boolean }) {
  const { sheet, viewer: state } = page
  const viewer = useViewer()
  const openLogin = useLogin()
  const { favorite } = useSheetActions(actor, sheet.rkey, sheet.did)
  const saved = (state?.favoriteUris.length ?? 0) > 0
  const mine = viewer?.did === sheet.did
  const [error, setError] = useState<string | null>(null)
  const text = (t: string) => (compact ? null : t)
  const icon = 'h-[1.1rem] w-[1.1rem]'

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <button
        type="button"
        className={clsx('btn', compact && 'px-0', saved && 'btn-on')}
        aria-pressed={saved}
        aria-label={compact ? 'Save' : undefined}
        disabled={favorite.isPending}
        onClick={() =>
          viewer
            ? favorite.mutate(!saved, { onError: (e) => setError(e.message) })
            : openLogin('Sign in to save songs to your list.')
        }
      >
        <Bookmark className={clsx(icon, saved && 'fill-current')} aria-hidden />
        {text(saved ? 'Saved' : 'Save')}
      </button>
      <Link
        to={`/new?fork=${encodeURIComponent(`${sheet.did}/${sheet.rkey}`)}`}
        className={clsx('btn', compact && 'px-0')}
        aria-label={compact ? 'Fork' : undefined}
        title="Start your own version from this one"
      >
        <GitFork className={icon} aria-hidden />
        {text('Fork')}
      </Link>
      {mine && (
        <Link to={`${sheetPath(sheet)}/edit`} className={clsx('btn', compact && 'px-0')} aria-label={compact ? 'Edit' : undefined}>
          <Pencil className={icon} aria-hidden />
          {text('Edit')}
        </Link>
      )}
      {!compact && (
        <button type="button" className="btn" onClick={() => window.print()}>
          <Printer className={icon} aria-hidden />
          Print
        </button>
      )}
      {error && <p className="basis-full text-right text-sm font-bold text-chord">{error}</p>}
    </div>
  )
}

function TitleBlock({ page, actor }: { page: SheetPageData; actor: string }) {
  const { sheet, viewer: state, versions } = page
  const viewer = useViewer()
  const openLogin = useLogin()
  const { rate } = useSheetActions(actor, sheet.rkey, sheet.did)
  const [error, setError] = useState<string | null>(null)
  const version = versions.find((v) => v.uri === sheet.uri)?.version
  const tuning = getTuning(sheet.tuning, sheet.kind)

  const facts = [
    sheet.kind !== 'chords' && KIND_LABEL[sheet.kind],
    sheet.key && `key of ${pretty(sheet.key)}`,
    sheet.capo > 0 && `capo ${sheet.capo}`,
    sheet.tuning && tuning.id !== 'standard' && `${tuning.name} tuning`,
    sheet.difficulty,
  ].filter(Boolean)

  return (
    <header className="flex flex-col gap-3">
      <div>
        <h1 className="text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl">{sheet.title}</h1>
        <p className="mt-1.5 text-lg font-bold text-ink-soft">
          <Link to={`/artists/${sheet.artistSlug}`} className="text-ink hover:underline">
            {sheet.artist}
          </Link>
          {facts.length > 0 && <>, {facts.join(', ')}</>}
        </p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold text-ink-soft">
          {versions.length > 1 && (
            <span>
              Version {version} of {versions.length}{' '}
              <Link to={`/songs/${sheet.artistSlug}/${sheet.titleSlug}`} className="font-extrabold text-chord hover:underline">
                see all
              </Link>
            </span>
          )}
          <AuthorLink author={sheet.author} />
          <span>
            {fmtDate(sheet.createdAt)}
            {sheet.updatedAt !== sheet.createdAt && <>, edited {fmtDate(sheet.updatedAt)}</>}
          </span>
          {sheet.forkOf && (
            <span className="inline-flex items-center gap-1">
              <GitFork className="h-3.5 w-3.5" aria-hidden />
              {page.forkOf ? (
                <>
                  forked from{' '}
                  <Link className="font-extrabold text-chord hover:underline" to={sheetPath(page.forkOf)}>
                    {handleText(page.forkOf.author)}'s version
                  </Link>
                </>
              ) : (
                'forked from a sheet that has been deleted'
              )}
            </span>
          )}
        </p>
      </div>
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <StarsInput
            value={state?.rating ?? 0}
            disabled={rate.isPending}
            onChange={(v) =>
              viewer ? rate.mutate(v, { onError: (e) => setError(e.message) }) : openLogin('Sign in to rate sheets.')
            }
          />
          <StarsShown avg={sheet.stats.ratingAvg} count={sheet.stats.ratingCount} />
        </div>
        <div className="hidden lg:block">
          <SheetActions page={page} actor={actor} />
        </div>
        {error && <p className="basis-full text-sm font-bold text-chord">{error}</p>}
      </div>
    </header>
  )
}

function Related({ page }: { page: SheetPageData }) {
  const others = page.versions.filter((v) => v.uri !== page.sheet.uri)
  if (!page.forks.length && !others.length) return null
  return (
    <div className="no-print mt-8 grid gap-8 md:grid-cols-2">
      {page.forks.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-black">Forks of this sheet</h2>
          <SheetList sheets={page.forks} showSong={false} version={() => 'Fork'} />
        </section>
      )}
      {others.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-black">Other versions</h2>
          <SheetList
            sheets={others}
            showSong={false}
            version={(s) => `Version ${others.find((o) => o.uri === s.uri)?.version}`}
          />
        </section>
      )}
    </div>
  )
}

/** What the bottom bar's Key control shows: the key being played, or the shift. */
function keyValue(c: Controls) {
  if (c.shapeKey) return pretty(keyText(c.shapeKey, keyUsesFlats(c.shapeKey)))
  return c.transpose === 0 ? '0' : `${c.transpose > 0 ? '+' : ''}${c.transpose}`
}

/** Desktop: every control, labelled. */
function Rail({ c }: { c: Controls }) {
  return (
    <>
      <Stepper
        label="Transpose"
        value={c.transpose === 0 ? 'original' : `${c.transpose > 0 ? '+' : ''}${c.transpose}`}
        detail={c.soundingKey ? `sounds in ${pretty(keyText(c.soundingKey, keyUsesFlats(c.soundingKey)))}` : undefined}
        onStep={c.stepTranspose}
        onReset={c.transpose ? () => c.setTranspose(0) : undefined}
      />
      {c.capoable && <Stepper label="Capo" value={c.capo === 0 ? 'none' : `fret ${c.capo}`} onStep={c.stepCapo} />}
      <Stepper
        label="Text size"
        value={`${c.fontSize}px`}
        onStep={(d) => c.setFontSize(Math.max(14, Math.min(34, c.fontSize + d)))}
      />
      <ChordToggles c={c} />
      <div>
        <div className="label">Autoscroll</div>
        <div className="flex items-center gap-3">
          <PlayButton c={c} size="md" />
          <SpeedSlider c={c} />
        </div>
      </div>
      <div>
        <div className="label">Hear the chords</div>
        <div className="flex items-center gap-3">
          <HearButton c={c} size="md" />
          <Stepper label="Tempo" value={`${c.bpm} bpm`} onStep={c.stepBpm} bare />
        </div>
      </div>
      <div>
        <div className="label">Play along</div>
        <div className="flex items-center gap-3">
          <ListenButton c={c} size="md" />
          <span className="text-sm font-semibold leading-snug text-ink-soft">
            {c.play.state.status === 'off' ? 'Play and the sheet keeps up with you.' : <PlayAlongStatus c={c} />}
          </span>
        </div>
      </div>
      <button type="button" className="btn btn-primary" onClick={() => c.setStage(true)}>
        <Maximize2 className="h-4 w-4" aria-hidden />
        Stage mode
      </button>
    </>
  )
}

function PlayButton({ c, size }: { c: Controls; size: 'md' | 'lg' | 'xl' }) {
  const box = { md: 'h-12 w-12', lg: 'h-14 w-14', xl: 'h-[4.5rem] w-[4.5rem]' }[size]
  const ico = { md: 'h-5 w-5', lg: 'h-6 w-6', xl: 'h-7 w-7' }[size]
  return (
    <button
      type="button"
      className={clsx('btn btn-accent shrink-0 px-0', box)}
      onClick={c.toggleScrolling}
      aria-label={c.scrolling ? 'Pause autoscroll' : 'Start autoscroll'}
    >
      {c.scrolling ? <Pause className={clsx(ico, 'fill-current')} aria-hidden /> : <Play className={clsx(ico, 'fill-current')} aria-hidden />}
    </button>
  )
}

/** Plays the whole chart, a bar per chord, lighting each chord up. */
function HearButton({ c, size }: { c: Controls; size: 'md' | 'xl' }) {
  const box = { md: 'h-12 w-12', xl: 'h-14 w-14' }[size]
  const ico = { md: 'h-5 w-5', xl: 'h-6 w-6' }[size]
  return (
    <button
      type="button"
      className={clsx('btn shrink-0 px-0', box, c.hearing && 'btn-on')}
      onClick={c.toggleHearing}
      aria-pressed={c.hearing}
      aria-label={c.hearing ? 'Stop playing the chords' : 'Hear the chords: play the chart through'}
      title={c.hearing ? 'Stop' : 'Hear the chords, a bar each'}
    >
      {c.hearing ? <Square className={clsx(ico, 'fill-current')} aria-hidden /> : <Volume2 className={ico} aria-hidden />}
    </button>
  )
}

/** Starts and stops play-along. */
function ListenButton({ c, size, className }: { c: Controls; size: 'md' | 'lg' | 'xl'; className?: string }) {
  const box = { md: 'h-12 w-12', lg: 'h-12 w-11', xl: 'h-14 w-14' }[size]
  const ico = { md: 'h-5 w-5', lg: 'h-5 w-5', xl: 'h-6 w-6' }[size]
  const on = c.play.active
  return (
    <button
      type="button"
      className={clsx('btn shrink-0 px-0', box, on ? 'btn-on' : className)}
      onClick={c.togglePlayAlong}
      aria-pressed={on}
      aria-label={on ? 'Stop playing along' : 'Play along: follow my playing'}
      title={on ? 'Stop playing along' : 'Play along: the sheet follows your playing. Listens on this device only.'}
    >
      {on ? <MicOff className={ico} aria-hidden /> : <Mic className={ico} aria-hidden />}
    </button>
  )
}

const HEARD_SUFFIX: Record<Quality, string> = {
  maj: '', min: 'm', dim: 'dim', aug: 'aug', min6: 'm6', maj6: '6', min7: 'm7', minmaj7: 'm(maj7)',
  maj7: 'maj7', '7': '7', dim7: 'dim7', hdim7: 'm7b5', sus2: 'sus2', sus4: 'sus4',
  '5': '5', add9: 'add9', '9': '9', min9: 'm9', maj9: 'maj9', '7sus4': '7sus4',
}

/** One line on what play-along is doing. */
function PlayAlongStatus({ c }: { c: Controls }) {
  const s: PlayAlongState = c.play.state
  if (s.status === 'loading') {
    return <>Getting the listener ready{s.fraction > 0 && s.fraction < 1 ? ` (${Math.round(s.fraction * 100)}%)` : '…'}</>
  }
  if (s.status === 'error') return <>{s.message}</>
  if (s.status !== 'listening') return null
  if (s.silent || s.heard === null) return <>Listening. Start playing whenever you're ready.</>
  const h = btcChord(s.heard)!
  // Name it as the page would: undo the offset the audio showed, apply the page's shift.
  const shown = noteName(h.root - s.offset + c.options.shift, c.flats) + HEARD_SUFFIX[h.quality]
  return (
    <>
      Hearing <span className="font-black text-chord">{pretty(shown)}</span>
    </>
  )
}

/** Keeps the chord being played along to in view, a third of the way down. */
function useFollowScroll(
  now: Segment | null,
  root: React.RefObject<HTMLElement>,
  scroller: React.RefObject<HTMLElement> | null,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled || !now) return
    const el = root.current?.querySelector('[data-now]')
    if (!el) return
    const box = scroller?.current?.getBoundingClientRect() ?? { top: 0, height: window.innerHeight }
    const y = el.getBoundingClientRect().top - box.top
    if (y > box.height * 0.18 && y < box.height * 0.6) return
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    ;(scroller?.current ?? window).scrollBy({ top: y - box.height * 0.33, behavior })
  }, [now, root, scroller, enabled])
}

function ChordToggles({ c }: { c: Controls }) {
  return (
    <div>
      <div className="label">Chords</div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={c.simplify}
          onClick={() => c.setSimplify(!c.simplify)}
          className={clsx('btn btn-sm', c.simplify ? 'btn-on' : 'bg-bg lg:bg-surface-raised')}
        >
          Simplify
        </button>
        <button type="button" onClick={c.toggleAccidentals} className="btn btn-sm bg-bg lg:bg-surface-raised" title="Spell chords with sharps or flats">
          {c.flats ? '♭ flats' : '♯ sharps'}
        </button>
      </div>
    </div>
  )
}

function SpeedSlider({ c }: { c: Controls }) {
  return (
    <input
      type="range"
      min={1}
      max={10}
      value={c.speed}
      onChange={(e) => c.setSpeed(Number(e.target.value))}
      aria-label="Scroll speed"
      className="w-full accent-[rgb(var(--chord))]"
    />
  )
}

function Stepper({
  label,
  value,
  detail,
  onStep,
  onReset,
  bare,
}: {
  label: string
  value: string
  detail?: string
  onStep: (d: number) => void
  onReset?: () => void
  /** Without its label (it's beside a button that says what it's for). */
  bare?: boolean
}) {
  return (
    <div>
      {!bare && <div className="label">{label}</div>}
      <div className="flex items-center gap-1">
        <button type="button" className="btn bg-bg px-0 lg:bg-surface-raised" onClick={() => onStep(-1)} aria-label={`${label} down`}>
          <Minus className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          className="min-w-[5.5rem] px-1 text-center font-extrabold disabled:cursor-default"
          onClick={onReset}
          disabled={!onReset}
          title={onReset ? 'Reset' : undefined}
        >
          {value}
        </button>
        <button type="button" className="btn bg-bg px-0 lg:bg-surface-raised" onClick={() => onStep(1)} aria-label={`${label} up`}>
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {detail && <div className="mt-1 text-xs font-bold text-ink-soft">{detail}</div>}
    </div>
  )
}

/** Phones: the controls you reach for mid-song, under your thumb. */
function BottomBar({ c }: { c: Controls }) {
  const [more, setMore] = useState(false)
  const mini = (label: string, value: string, onStep: (d: number) => void) => (
    <div className="flex flex-col items-center">
      <span className="text-[0.65rem] font-extrabold text-ink-soft">{label}</span>
      <div className="flex items-center">
        <button type="button" className="flex h-10 w-8 items-center justify-center" onClick={() => onStep(-1)} aria-label={`${label} down`}>
          <Minus className="h-4 w-4" aria-hidden />
        </button>
        <span className="min-w-[1.5rem] text-center text-lg font-black">{value}</span>
        <button type="button" className="flex h-10 w-8 items-center justify-center" onClick={() => onStep(1)} aria-label={`${label} up`}>
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  )
  return (
    <div className="no-print fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 mx-auto max-w-md lg:hidden">
      {c.play.state.status !== 'off' && !more && (
        <div className="mb-2 flex items-center justify-between gap-3 rounded-[20px] border border-rule bg-surface px-4 py-2.5 text-sm font-bold shadow-float" role="status">
          <span>
            <PlayAlongStatus c={c} />
          </span>
          {c.play.state.status === 'error' && (
            <button type="button" className="shrink-0 underline" onClick={c.play.stop}>
              Dismiss
            </button>
          )}
        </div>
      )}
      {more && (
        <div className="mb-2 flex flex-col gap-4 rounded-[24px] border border-rule bg-surface p-4 shadow-float">
          <Stepper
            label="Text size"
            value={`${c.fontSize}px`}
            onStep={(d) => c.setFontSize(Math.max(14, Math.min(34, c.fontSize + d)))}
          />
          <ChordToggles c={c} />
          <div>
            <div className="label">Scroll speed</div>
            <SpeedSlider c={c} />
          </div>
          <div>
            <div className="label">Hear the chords</div>
            <div className="flex items-center gap-3">
              <HearButton c={c} size="md" />
              <Stepper label="Tempo" value={`${c.bpm} bpm`} onStep={c.stepBpm} bare />
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setMore(false)
              c.setStage(true)
            }}
          >
            <Maximize2 className="h-4 w-4" aria-hidden />
            Stage mode
          </button>
        </div>
      )}
      <div className="flex items-center justify-between rounded-[28px] border border-rule bg-surface px-1.5 py-1.5 shadow-float">
        {mini('Key', keyValue(c), c.stepTranspose)}
        {c.capoable ? mini('Capo', String(c.capo), c.stepCapo) : <span className="w-24" />}
        <PlayButton c={c} size="lg" />
        <ListenButton c={c} size="lg" className="bg-transparent" />
        <button
          type="button"
          className={clsx('btn h-12 w-11 bg-transparent px-0', more && 'btn-on')}
          aria-expanded={more}
          aria-label="Text size, chord spelling and stage mode"
          onClick={() => setMore(!more)}
        >
          <Type className="h-5 w-5" aria-hidden />
        </button>
      </div>
    </div>
  )
}

/**
 * Stage mode: the sheet alone, bigger, with the line you're on marked and
 * the lines you've played faded. The screen stays awake.
 */
function Stage({ page, c }: { page: SheetPageData; c: Controls }) {
  const tuning = getTuning(page.sheet.tuning, page.sheet.kind)
  const stageTips = { strings: shapeStrings(tuning) }
  const ref = useRef<HTMLDivElement>(null)
  const [progress, setProgress] = useState(0)
  const { setStage, setScrolling } = c
  useAutoScroll(c.scrolling, c.speed, ref, () => setScrolling(false))
  useFollowScroll(c.now, ref, ref, true)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    document.body.style.overflow = 'hidden'
    let frame = 0
    const update = () => {
      frame = 0
      const max = el.scrollHeight - el.clientHeight
      setProgress(max > 0 ? el.scrollTop / max : 0)
      // The reading line sits a third of the way down the screen.
      const reading = el.getBoundingClientRect().top + el.clientHeight * 0.33
      let current: Element | null = null
      for (const line of el.querySelectorAll('[data-line]')) {
        const r = line.getBoundingClientRect()
        line.toggleAttribute('data-past', r.bottom < reading)
        line.removeAttribute('data-current')
        if (!current && r.bottom >= reading) current = line
      }
      current?.setAttribute('data-current', '')
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    el.addEventListener('scroll', onScroll, { passive: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setStage(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      el.removeEventListener('scroll', onScroll)
      window.removeEventListener('keydown', onKey)
      cancelAnimationFrame(frame)
    }
  }, [setStage])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg" role="dialog" aria-modal="true" aria-label={`${page.sheet.title}, stage mode`}>
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-6 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <span className="truncate font-extrabold text-ink-soft">
          {page.sheet.title}
          {c.capo > 0 && `, capo ${c.capo}`}
        </span>
        <button type="button" className="btn" onClick={() => setStage(false)}>
          <X className="h-4 w-4" aria-hidden />
          Exit
        </button>
      </div>
      {c.play.state.status !== 'off' && (
        <p className="mx-auto mt-2 w-full max-w-3xl px-6 text-sm font-bold text-ink-soft" role="status">
          <PlayAlongStatus c={c} />
        </p>
      )}
      <div className="mx-auto mt-3 w-full max-w-3xl px-6">
        <div className="h-1 rounded-full bg-surface">
          <div className="h-1 rounded-full bg-chord" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
      <div ref={ref} className="stage flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 pb-[70vh] pt-[18vh]">
          <ChordTipContext.Provider value={stageTips}>
            <SheetView doc={c.doc} options={{ ...c.options, fontSize: c.options.fontSize + 7 }} now={c.now} className="font-bold" />
          </ChordTipContext.Provider>
        </div>
      </div>
      <div className="flex items-center justify-center gap-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
        <button type="button" className="btn h-14 w-14 px-0" aria-label="Slower" onClick={() => c.setSpeed(Math.max(1, c.speed - 1))}>
          <Minus className="h-5 w-5" aria-hidden />
        </button>
        <PlayButton c={c} size="xl" />
        <ListenButton c={c} size="xl" />
        <HearButton c={c} size="xl" />
        <button type="button" className="btn h-14 w-14 px-0" aria-label="Faster" onClick={() => c.setSpeed(Math.min(10, c.speed + 1))}>
          <Plus className="h-5 w-5" aria-hidden />
        </button>
      </div>
    </div>
  )
}

/** Scrolls the window (or an element) at a steady pace. */
function useAutoScroll(
  running: boolean,
  speed: number,
  target: React.RefObject<HTMLElement> | null,
  onEnd: () => void,
) {
  const end = useRef(onEnd)
  end.current = onEnd
  useEffect(() => {
    if (!running) return
    let last = performance.now()
    let carry = 0
    let frame = 0
    const tick = (now: number) => {
      carry += ((now - last) / 1000) * speed * 7
      last = now
      const px = Math.floor(carry)
      if (px > 0) {
        carry -= px
        const el = target?.current
        if (el) {
          el.scrollTop += px
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) return end.current()
        } else {
          window.scrollBy(0, px)
          if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 1) return end.current()
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [running, speed, target])
}

/** Keeps the screen on while playing (where the browser allows it). */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let released = false
    const acquire = () =>
      navigator.wakeLock
        .request('screen')
        .then((l) => {
          if (released) l.release()
          else lock = l
        })
        .catch(() => {})
    acquire()
    // The lock drops when the tab is hidden; take it back on return.
    const onVisible = () => {
      if (document.visibilityState === 'visible') acquire()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      released = true
      lock?.release()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active])
}

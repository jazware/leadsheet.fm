import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { clsx } from 'clsx'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Bookmark, ChevronDown, ExternalLink, GitFork, Maximize2, Mic, MicOff, Minus, Pause, Pencil, Play, Plus, Printer, SlidersHorizontal, Square, Volume2, X } from 'lucide-react'
import { api, KIND_LABEL, sheetInput, sheetPath, type SheetPage as SheetPageData } from '@/lib/api'
import { chordsIn, parseChordPro, type Segment } from '@/lib/chordpro'
import { embedFor, isWebLink, linkLabel } from '@/lib/links'
import { keyText, keyUsesFlats, mod12, noteName, parseKey, pretty, simplifyQuality, type Quality } from '@/lib/music'
import { getTuning, instrumentOf, shapeStrings, tuningsFor, type Instrument } from '@/lib/tunings'
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
import { ChordSoundContext, resolvePiano, resolveVoicing, SheetShapesProvider, sheetShapes, usePicks } from '@/components/Voicings'
import { BEATS_PER_CHORD, chordPitches, playThrough } from '@/lib/pluck'
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

export const INSTRUMENT_NAME: Record<Instrument, string> = { guitar: 'Guitar', ukulele: 'Ukulele', bass: 'Bass', piano: 'Piano' }
// A sheet kind for each fretted instrument, to look up its tunings.
const KIND_OF: Record<Exclude<Instrument, 'piano'>, string> = { guitar: 'chords', ukulele: 'ukulele', bass: 'bass' }

/** Everything the controls change, shared by the rail, the bottom bar and stage mode. */
function useSheetControls(page: SheetPageData) {
  const { sheet } = page
  const doc = useMemo(() => parseChordPro(sheet.content), [sheet.content])
  const chords = useMemo(() => chordsIn(doc), [doc])
  const [transpose, setTranspose] = useState(0)
  // What the reader plays: the sheet's instrument, or another they chose
  // (remembered, for every sheet). Another instrument reads the chords at
  // sounding pitch: its capo starts at none.
  const written = instrumentOf(sheet.kind)
  const [readAs, setReadAs] = usePref<Instrument | null>('readAs', null)
  const instrument = readAs ?? written
  const [capo, setCapo] = useState(instrument === written ? sheet.capo : 0)
  // The reader's tuning, when not the one the sheet is for (not remembered:
  // a sheet opens in its own tuning).
  const [tuningId, setTuningId] = useState<string | null>(null)
  const setInstrument = (i: Instrument) => {
    setReadAs(i === written ? null : i)
    setCapo(i === written ? sheet.capo : 0)
    setTuningId(null)
  }
  const [simplify, setSimplify] = useState(false)
  const [accidentals, setAccidentals] = useState<Accidentals>('auto')
  const [fontSize, setFontSize] = usePref('fontSize', 20)
  const [speed, setSpeed] = usePref('scrollSpeed', 3)
  const [scrolling, setScrolling] = useState(false)
  const [stage, setStage] = useState(false)

  // The strings: the reader's tuning, or else the sheet's on its own
  // instrument and standard on another; none on piano.
  const sheetTuning = getTuning(sheet.tuning, sheet.kind)
  const sheetShift = written === 'piano' ? 0 : sheetTuning.shift
  const tuningKind = instrument === 'piano' ? null : instrument === written ? sheet.kind : KIND_OF[instrument]
  const tunings = tuningKind ? tuningsFor(tuningKind) : []
  const tuning = tuningKind ? getTuning(tuningId ?? (instrument === written ? sheet.tuning : 'standard'), tuningKind) : null
  const asWritten = instrument === written && tuning?.id === sheetTuning.id
  // Chords are named for the shapes played. The song sounds at the sheet's
  // shapes plus its capo, less its tuning's drop; the reader's shapes are
  // that, less their capo, plus their own tuning's drop.
  const shift = transpose + sheet.capo - sheetShift - capo + (tuning?.shift ?? 0)
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
    () => (shift === 0 && own.size && asWritten ? { shapes: own, scope: sheet.uri } : null),
    [shift, own, sheet.uri, asWritten],
  )
  const strings = tuning ? shapeStrings(tuning) : []
  // Chord boxes and the play-through sound as the reader would play them:
  // their capo, the real tuning.
  const sound = useMemo(() => ({ strings: tuning?.strings ?? [], capo, instrument }), [tuning, capo, instrument])
  // Capos are for guitar and ukulele.
  const capoable = instrument === 'guitar' || instrument === 'ukulele'

  // Hearing the whole chart: the shapes the boxes show, each chord a bar.
  const picks = usePicks()
  const [bpm, setBpm] = usePref('bpm', 90)
  const [hearing, setHearing] = useState<number | null>(null)
  const stopHearing = useRef<(() => void) | null>(null)
  const sequence = useMemo(() => playAlongChords(doc).segments, [doc])
  const hear = (from = 0, tempo = bpm) => {
    stopHearing.current?.()
    const notes = sequence.map((seg) => {
      const c = seg.chord!
      const shown = {
        ...c,
        root: mod12(c.root + shift),
        bass: c.bass === null ? null : mod12(c.bass + shift),
        quality: simplify && c.quality ? simplifyQuality(c.quality) : c.quality,
      }
      const played =
        instrument === 'piano'
          ? resolvePiano(shown, picks)?.notes
          : (() => {
              const frets = resolveVoicing(shown, strings, shapes, picks)?.frets
              return frets && chordPitches(frets, sound.strings, capo)
            })()
      // The sheet doesn't say how long chords last: a bar each.
      return { notes: played ?? null, beats: BEATS_PER_CHORD }
    })
    stopHearing.current = playThrough(notes, tempo, setHearing, () => {
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
  // A new instrument (or key, capo, spelling or voicing) takes over from the
  // chord that's playing, as a new tempo does.
  const latest = useRef({ hear, hearing })
  latest.current = { hear, hearing }
  const heard = [instrument, shift, capo, simplify, strings.join(), sound.strings.join(), JSON.stringify(picks)].join('|')
  useEffect(() => {
    const { hear, hearing } = latest.current
    if (hearing !== null) hear(hearing)
  }, [heard])

  const now = play.state.status === 'listening' ? play.state.now : hearing !== null ? sequence[hearing] ?? null : null

  return {
    doc, chords, options, flats,
    transpose, setTranspose, capo, setCapo, simplify, setSimplify,
    toggleAccidentals: () => setAccidentals(flats ? 'sharps' : 'flats'),
    fontSize, setFontSize, speed, setSpeed, scrolling, setScrolling, stage, setStage,
    soundingKey, shapeKey,
    play, now, shapes, sound, capoable,
    instrument, written, setInstrument, tuning, strings, sheetTuning, tunings, setTuningId,
    hearing: hearing !== null, bpm,
    // Clicking a chord while the chart plays carries on from there.
    // Returns whether it did (otherwise the chord just strums).
    playFrom: (seg: Segment) => {
      const i = sequence.indexOf(seg)
      if (hearing === null || i < 0) return false
      hear(i)
      return true
    },
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
  const tuning = c.tuning

  useEffect(() => rememberSheet(sheet), [sheet])
  useAutoScroll(c.scrolling && !c.stage, c.speed, null, () => c.setScrolling(false))
  useWakeLock(c.scrolling || c.stage || c.play.active || c.hearing)
  const sheetRef = useRef<HTMLDivElement>(null)
  const railRef = useRef<HTMLDivElement>(null)
  useFitWindow(railRef)
  useFollowScroll(c.now, sheetRef, null, !c.stage)
  const { shapes, sound } = c

  const diagrams = c.chords.length > 0 && (
    <div
      className={clsx(
        '-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 lg:mx-0 lg:grid lg:overflow-visible lg:px-0',
        c.instrument === 'piano' ? 'lg:grid-cols-2' : 'lg:grid-cols-3',
      )}
    >
      {c.chords.map((ch, i) => (
        <ChordDiagram
          key={i}
          chord={{
            ...ch,
            root: mod12(ch.root + c.options.shift),
            bass: ch.bass === null ? null : mod12(ch.bass + c.options.shift),
            quality: c.simplify && ch.quality ? simplifyQuality(ch.quality) : ch.quality,
          }}
          label={chordLabel(ch, c.options)}
          flats={c.flats}
          strings={c.strings}
          instrument={c.instrument}
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
            {sheet.draft && <DraftBanner page={page} />}
          <TitleBlock page={page} actor={actor} />
            {sheet.description && (
              <p className="card whitespace-pre-line px-4 py-3 font-semibold text-ink-soft">{sheet.description}</p>
            )}
            <div className="no-print lg:hidden">{diagrams}</div>
            <div ref={sheetRef}>
              <ChordTipContext.Provider value={{ strings: c.strings, instrument: c.instrument }}>
                <SheetView doc={c.doc} options={c.options} now={c.now} onChordClick={c.playFrom} className="max-w-[40rem] pt-1" />
              </ChordTipContext.Provider>
            </div>
            <Related page={page} />
          </div>
          <aside className="no-print hidden lg:block">
            {/* Never past the bottom of the window: the shapes scroll inside
                it (see ScrollShapes). On a window too short even for two rows
                of them, the card itself scrolls. */}
            <div ref={railRef} className="card sticky top-4 flex max-h-[calc(100dvh-2rem)] flex-col gap-4 overflow-y-auto p-4">
              <div className="flex shrink-0 flex-col gap-4">
                <SidebarControls c={c} />
              </div>
              {diagrams && (
                <ScrollShapes
                  label={
                    <>
                      {c.instrument !== c.written ? `${INSTRUMENT_NAME[c.instrument]} shapes` : 'Shapes'}
                      {tuning && tuning.id !== 'standard' && <>, {tuning.name}</>}
                    </>
                  }
                >
                  {diagrams}
                </ScrollShapes>
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

/**
 * The sidebar's chord shapes: they take the room the controls leave and
 * scroll on their own, never shrinking below two rows. An edge fades while
 * there's more beyond it, and scrolling them doesn't scroll the page.
 */
function ScrollShapes({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState({ top: false, bottom: false })
  // How many shapes are wholly or partly below the fold, for the "more" pill.
  const [below, setBelow] = useState(0)
  const [twoRows, setTwoRows] = useState<number | undefined>()

  useEffect(() => {
    const el = list.current
    if (!el) return
    const update = () => {
      setFade({ top: el.scrollTop > 2, bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 2 })
      const grid = el.firstElementChild as HTMLElement | null
      const fold = el.getBoundingClientRect().bottom - 8
      setBelow(grid ? [...grid.children].filter((b) => b.getBoundingClientRect().bottom > fold).length : 0)
      // Two rows of boxes: the first box's height, twice, plus the gap.
      const first = grid?.firstElementChild as HTMLElement | null
      if (grid && first) setTwoRows(first.offsetHeight * 2 + parseFloat(getComputedStyle(grid).rowGap || '0'))
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [])

  return (
    <div ref={box} className="relative flex min-h-0 flex-1 flex-col" style={{ minHeight: twoRows !== undefined ? twoRows + 24 : undefined }}>
      <div className="label shrink-0">{label}</div>
      <div
        ref={list}
        tabIndex={0}
        aria-label="Chord shapes"
        className={clsx('shapes-scroll -mx-4 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 focus-visible:ring-inset', fade.top && 'fade-top', fade.bottom && 'fade-bottom')}
      >
        {children}
      </div>
      {fade.bottom && below > 0 && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          className="absolute bottom-1 left-1/2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full border border-rule bg-surface-raised py-1 pl-3 pr-2 text-[0.75rem] font-extrabold text-ink shadow-float hover:text-chord"
          onClick={() => list.current?.scrollBy({ top: list.current.clientHeight * 0.8, behavior: 'smooth' })}
        >
          {below} more {below === 1 ? 'shape' : 'shapes'}
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  )
}

/**
 * Keeps a sticky card's bottom inside the window. Its CSS max height fits
 * once it has stuck to the top; until then it starts lower down (under the
 * header and title), so the height left below it is less.
 */
function useFitWindow(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // (Scroll events come at most once a frame already.)
    const fit = () => {
      const top = Math.max(16, el.getBoundingClientRect().top)
      el.style.maxHeight = `${window.innerHeight - top - 16}px`
    }
    fit()
    window.addEventListener('scroll', fit, { passive: true })
    window.addEventListener('resize', fit)
    return () => {
      window.removeEventListener('scroll', fit)
      window.removeEventListener('resize', fit)
    }
  }, [ref])
}

/** A small − value + stepper, for the compact controls. */
function Mini({ label, value, sub, onStep, onReset }: { label: string; value: string; sub?: string; onStep: (d: number) => void; onReset?: () => void }) {
  return (
    <div className="rounded-2xl bg-surface-raised px-1.5 py-1.5">
      <div className="px-1 text-[0.7rem] font-extrabold text-ink-soft">{label}</div>
      <div className="flex items-center justify-between">
        <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface" onClick={() => onStep(-1)} aria-label={`${label} down`}>
          <Minus className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button type="button" className="min-w-0 truncate text-[0.95rem] font-black disabled:cursor-default" onClick={onReset} disabled={!onReset} title={onReset ? 'Reset' : undefined}>
          {value}
        </button>
        <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface" onClick={() => onStep(1)} aria-label={`${label} up`}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      {sub && <div className="truncate px-1 text-center text-[0.65rem] font-bold text-ink-faint">{sub}</div>}
    </div>
  )
}

const keyLabel = (c: Controls) =>
  c.soundingKey ? pretty(keyText(c.soundingKey, keyUsesFlats(c.soundingKey))) : c.transpose === 0 ? '0' : `${c.transpose > 0 ? '+' : ''}${c.transpose}`
const transposeLabel = (c: Controls) => (c.transpose === 0 ? 'original key' : `${c.transpose > 0 ? '+' : ''}${c.transpose} semitones`)

/** Guitar / Uke / Bass / Piano as one segmented switch. */
function InstrumentSwitch({ c, roomy }: { c: Controls; roomy?: boolean }) {
  const short: Record<Instrument, string> = { guitar: 'Guitar', ukulele: 'Uke', bass: 'Bass', piano: 'Piano' }
  return (
    <div role="radiogroup" aria-label="Show the chords for" className="grid grid-cols-4 gap-0.5 rounded-full bg-surface-raised p-1">
      {(['guitar', 'ukulele', 'bass', 'piano'] as const).map((i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={c.instrument === i}
          onClick={() => c.setInstrument(i)}
          title={i === c.written ? `${INSTRUMENT_NAME[i]}, as the sheet is written` : `For ${INSTRUMENT_NAME[i].toLowerCase()}, at sounding pitch`}
          className={clsx('relative rounded-full font-extrabold', roomy ? 'h-9 text-sm' : 'h-7 text-xs', c.instrument === i ? 'bg-glow text-glow-ink' : 'text-ink-soft hover:text-ink')}
        >
          {/* The dot marks the instrument the sheet is written for; it hangs
              off the word, so the word stays centred. */}
          <span className="relative">
            {short[i]}
            {i === c.written && <span className="absolute -right-1.5 top-0 h-1 w-1 rounded-full bg-current opacity-60" aria-hidden />}
          </span>
        </button>
      ))}
    </div>
  )
}

/**
 * The reader's tuning. Chords and shapes follow it, so they still sound
 * like the song: down a half step, the shapes go up one.
 */
function TuningSelect({ c, roomy }: { c: Controls; roomy?: boolean }) {
  if (!c.tuning) return null
  const written = c.instrument === c.written ? c.sheetTuning.id : null
  return (
    <label className={clsx('flex items-center gap-2 font-extrabold text-ink-soft', roomy ? 'text-sm' : 'text-[0.75rem]')}>
      <span className="w-12 shrink-0">Tuning</span>
      <span className="relative min-w-0 flex-1">
        <select
          className={clsx(
            'w-full appearance-none truncate rounded-full bg-surface-raised pl-3 pr-8 font-extrabold text-ink hover:text-chord',
            roomy ? 'h-9 text-sm' : 'h-7 text-xs',
          )}
          value={c.tuning.id}
          onChange={(e) => c.setTuningId(e.target.value)}
        >
          {c.tunings.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.id === written ? ' (as written)' : ''}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" aria-hidden />
      </span>
    </label>
  )
}

/** One of the playback buttons: an icon over a word. */
function Tile({ icon, label, on, onClick, title }: { icon: React.ReactNode; label: string; on?: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className={clsx('flex flex-col items-center gap-1 rounded-2xl py-2 text-[0.7rem] font-extrabold', on ? 'bg-glow text-glow-ink' : 'bg-surface-raised text-ink hover:text-chord')}
    >
      {icon}
      {label}
    </button>
  )
}

/** Speed and tempo, as one line each. */
function PlaybackSettings({ c, roomy }: { c: Controls; roomy?: boolean }) {
  const step = clsx('flex items-center justify-center rounded-full bg-surface-raised hover:text-ink', roomy ? 'h-9 w-9' : 'h-7 w-7')
  return (
    <div className={clsx('flex flex-col font-extrabold text-ink-soft', roomy ? 'gap-2 text-sm' : 'gap-1.5 text-[0.75rem]')}>
      <label className="flex items-center gap-2">
        <span className="w-12 shrink-0">Scroll</span>
        <SpeedSlider c={c} />
      </label>
      <div className="flex items-center gap-2">
        <span className="w-12 shrink-0">Tempo</span>
        <button type="button" className={step} onClick={() => c.stepBpm(-1)} aria-label="Tempo down">
          <Minus className="h-3 w-3" aria-hidden />
        </button>
        <span className={clsx('text-center text-ink', roomy ? 'w-16' : 'w-14')}>{c.bpm} bpm</span>
        <button type="button" className={step} onClick={() => c.stepBpm(1)} aria-label="Tempo up">
          <Plus className="h-3 w-3" aria-hidden />
        </button>
      </div>
    </div>
  )
}

/** Simplify, sharps or flats, and (where there's room) text size, in one row. */
function SpellingRow({ c, textSize }: { c: Controls; textSize: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" aria-pressed={c.simplify} onClick={() => c.setSimplify(!c.simplify)} className={clsx('btn btn-sm', c.simplify ? 'btn-on' : 'bg-surface-raised')}>
        Simplify
      </button>
      <button type="button" onClick={c.toggleAccidentals} className="btn btn-sm bg-surface-raised" title="Spell chords with sharps or flats">
        {c.flats ? '♭ flats' : '♯ sharps'}
      </button>
      {textSize && (
        <span className="ml-auto flex items-center rounded-full bg-surface-raised" title="Text size">
          <button type="button" className="flex h-9 w-8 items-center justify-center text-xs font-black" onClick={() => c.setFontSize(Math.max(14, c.fontSize - 1))} aria-label="Smaller text">
            A
          </button>
          <button type="button" className="flex h-9 w-8 items-center justify-center text-base font-black" onClick={() => c.setFontSize(Math.min(34, c.fontSize + 1))} aria-label="Larger text">
            A
          </button>
        </span>
      )}
    </div>
  )
}

/** The desktop sidebar's controls, compact: all of them above the shapes in one screenful. */
function SidebarControls({ c }: { c: Controls }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Mini label="Key" value={keyLabel(c)} sub={transposeLabel(c)} onStep={c.stepTranspose} onReset={c.transpose ? () => c.setTranspose(0) : undefined} />
        {c.capoable ? (
          <Mini label="Capo" value={c.capo === 0 ? 'none' : String(c.capo)} sub={c.capo === 0 ? 'no capo' : `fret ${c.capo}`} onStep={c.stepCapo} />
        ) : (
          <Mini label="Text" value={`${c.fontSize}px`} onStep={(d) => c.setFontSize(Math.max(14, Math.min(34, c.fontSize + d)))} />
        )}
      </div>
      <InstrumentSwitch c={c} />
      <TuningSelect c={c} />
      <SpellingRow c={c} textSize={c.capoable} />
      <div className="h-px bg-rule" />
      <div className="grid grid-cols-4 gap-1.5">
        <Tile
          icon={c.scrolling ? <Pause className="h-4 w-4 fill-current" aria-hidden /> : <Play className="h-4 w-4 fill-current" aria-hidden />}
          label="Scroll"
          on={c.scrolling}
          onClick={c.toggleScrolling}
          title="Autoscroll"
        />
        <Tile
          icon={c.hearing ? <Square className="h-4 w-4 fill-current" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}
          label="Hear"
          on={c.hearing}
          onClick={c.toggleHearing}
          title="Hear the chords, a bar each"
        />
        <Tile
          icon={c.play.active ? <MicOff className="h-4 w-4" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
          label="Follow"
          on={c.play.active}
          onClick={c.togglePlayAlong}
          title="Play along: the sheet follows your playing. Listens on this device only."
        />
        <Tile icon={<Maximize2 className="h-4 w-4" aria-hidden />} label="Stage" onClick={() => c.setStage(true)} title="Stage mode" />
      </div>
      {c.play.state.status !== 'off' && (
        <p className="text-[0.8rem] font-bold leading-snug text-ink-soft" role="status">
          <PlayAlongStatus c={c} />
        </p>
      )}
      <PlaybackSettings c={c} />
      <div className="h-px bg-rule" />
    </>
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
      {!sheet.draft && (
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
      )}
      {!sheet.draft && (
        <Link
          to={`/new?fork=${encodeURIComponent(`${sheet.did}/${sheet.rkey}`)}`}
          className={clsx('btn', compact && 'px-0')}
          aria-label={compact ? 'Fork' : undefined}
          title="Start your own version from this one"
        >
          <GitFork className={icon} aria-hidden />
          {text('Fork')}
        </Link>
      )}
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

/** On your own draft: what a draft is, and a way to publish it. */
function DraftBanner({ page }: { page: SheetPageData }) {
  const { sheet } = page
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const publish = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.updateSheet(sheet.did, sheet.rkey, { ...sheetInput(sheet), draft: false })
      await qc.invalidateQueries()
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }
  return (
    <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-glow px-4 py-3 font-bold text-glow-ink">
      <p className="min-w-0 flex-1 basis-64">
        Draft. Only you see it on Leadsheet, though like everything in your atproto account it's publicly readable.
        {error && <span className="block text-sm">Couldn't publish: {error}</span>}
      </p>
      <button
        type="button"
        className="h-10 rounded-full bg-glow-ink px-5 font-extrabold text-glow disabled:opacity-60"
        disabled={busy}
        onClick={publish}
      >
        {busy ? 'Publishing…' : 'Publish'}
      </button>
    </div>
  )
}

/**
 * Where to hear the recording. YouTube, Spotify and SoundCloud links get a
 * play button that opens their player here, loaded only when pressed (so
 * just reading a sheet doesn't call those sites); the rest open in a tab.
 */
function ListenLinks({ links }: { links: string[] }) {
  const web = links.filter(isWebLink)
  const [playing, setPlaying] = useState<string | null>(null)
  if (!web.length) return null
  const embed = playing ? embedFor(playing) : null
  return (
    <div className="no-print mt-2 flex flex-col gap-2">
      <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
        <span className="text-ink-soft">Listen on</span>
        {web.map((l) =>
          embedFor(l) ? (
            <span key={l} className="pill inline-flex items-center gap-1.5 pr-1.5">
              <button
                type="button"
                className="inline-flex items-center gap-1 hover:text-chord"
                aria-pressed={playing === l}
                onClick={() => setPlaying(playing === l ? null : l)}
                title={playing === l ? 'Close the player' : 'Play it here'}
              >
                {playing === l ? <X className="h-3 w-3" aria-hidden /> : <Play className="h-3 w-3 fill-current" aria-hidden />}
                {linkLabel(l)}
              </button>
              <a href={l} target="_blank" rel="noopener noreferrer nofollow" className="text-ink-soft hover:text-chord" aria-label={`Open on ${linkLabel(l)}`} title={`Open on ${linkLabel(l)}`}>
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            </span>
          ) : (
            <a key={l} href={l} target="_blank" rel="noopener noreferrer nofollow" className="pill inline-flex items-center gap-1 hover:text-chord">
              {linkLabel(l)}
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          ),
        )}
      </p>
      {embed && (
        <div
          className={clsx('w-full max-w-[40rem] overflow-hidden rounded-2xl bg-surface', !embed.height && 'aspect-video')}
          style={embed.height ? { height: embed.height } : undefined}
        >
          <iframe
            key={embed.src}
            src={embed.src}
            title={embed.title}
            className="h-full w-full border-0"
            allow="autoplay; encrypted-media; clipboard-write; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      )}
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
        <ListenLinks links={sheet.links ?? []} />
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
        <div className={clsx('flex items-center gap-2', sheet.draft && 'invisible')}>
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
  // Next to nothing coming in: not quiet playing, a muted or wrong input.
  if (s.level < -80) return <>I can't hear the microphone. Check it's the right input and isn't muted.</>
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

/** Phones: the controls you reach for mid-song, under your thumb. */
function BottomBar({ c }: { c: Controls }) {
  const [more, setMore] = useState(false)
  // Fixed widths, so nothing in the bar moves as the key changes or the
  // capo comes and goes.
  const mini = (label: string, value: string, onStep: (d: number) => void, hidden = false) => (
    <div className={clsx('flex w-[5.5rem] shrink-0 flex-col items-center', hidden && 'invisible')} aria-hidden={hidden || undefined}>
      <span className="text-[0.65rem] font-extrabold text-ink-soft">{label}</span>
      <div className="flex items-center">
        <button type="button" className="flex h-10 w-7 items-center justify-center" onClick={() => onStep(-1)} aria-label={`${label} down`}>
          <Minus className="h-4 w-4" aria-hidden />
        </button>
        <span className="w-8 whitespace-nowrap text-center text-lg font-black tracking-tight">{value}</span>
        <button type="button" className="flex h-10 w-7 items-center justify-center" onClick={() => onStep(1)} aria-label={`${label} up`}>
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  )
  // Outside the page (a portal): on phones, autoscroll slides the page with a
  // transform, which would take a fixed bar inside it along too.
  return createPortal(
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
        <div className="mb-2 flex flex-col gap-3 rounded-[24px] border border-rule bg-surface p-3 shadow-float">
          <InstrumentSwitch c={c} roomy />
          <TuningSelect c={c} roomy />
          <SpellingRow c={c} textSize />
          <div className="h-px bg-rule" />
          <PlaybackSettings c={c} roomy />
          <div className="grid grid-cols-2 gap-2">
            <Tile
              icon={c.hearing ? <Square className="h-4 w-4 fill-current" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}
              label={c.hearing ? 'Stop' : 'Hear the chords'}
              on={c.hearing}
              onClick={c.toggleHearing}
            />
            <Tile
              icon={<Maximize2 className="h-4 w-4" aria-hidden />}
              label="Stage mode"
              onClick={() => {
                setMore(false)
                c.setStage(true)
              }}
            />
          </div>
        </div>
      )}
      <div className="flex items-center justify-between rounded-[28px] border border-rule bg-surface px-1.5 py-1.5 shadow-float">
        {mini('Key', keyValue(c), c.stepTranspose)}
        {mini('Capo', String(c.capo), c.stepCapo, !c.capoable)}
        <PlayButton c={c} size="lg" />
        <ListenButton c={c} size="lg" className="bg-transparent" />
        <button
          type="button"
          className={clsx('btn h-12 w-11 px-0', more ? 'btn-on' : 'bg-transparent')}
          aria-expanded={more}
          aria-label="More controls"
          onClick={() => setMore(!more)}
        >
          <SlidersHorizontal className="h-5 w-5" aria-hidden />
        </button>
      </div>
    </div>,
    document.body,
  )
}

/**
 * Stage mode: the sheet alone, bigger, with the line you're on marked and
 * the lines you've played faded. The screen stays awake.
 */
function Stage({ page, c }: { page: SheetPageData; c: Controls }) {
  const stageTips = { strings: c.strings, instrument: c.instrument }
  const ref = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const { setStage, setScrolling } = c
  useAutoScroll(c.scrolling, c.speed, ref, () => setScrolling(false))
  useFollowScroll(c.now, ref, ref, true)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    document.body.style.overflow = 'hidden'
    let frame = 0
    let shownCurrent: Element | null = null
    // Runs every frame while scrolling, so: all the reads, then only the
    // writes that change anything. (Reading a line's position after writing
    // to the one before forces a layout per line; with a whole sheet of
    // lines, that's what made autoscroll stutter on phones.) The progress bar
    // is set directly rather than through state, which would re-render the
    // whole sheet every frame.
    const update = () => {
      frame = 0
      const max = el.scrollHeight - el.clientHeight
      if (bar.current) bar.current.style.width = `${(max > 0 ? el.scrollTop / max : 0) * 100}%`
      // The reading line sits a third of the way down the screen.
      const reading = el.getBoundingClientRect().top + el.clientHeight * 0.33
      const lines = [...el.querySelectorAll('[data-line]')]
      const past = lines.map((line) => line.getBoundingClientRect().bottom < reading)
      const current = lines[past.indexOf(false)] ?? null
      lines.forEach((line, i) => {
        if (line.hasAttribute('data-past') !== past[i]) line.toggleAttribute('data-past', past[i])
      })
      if (current !== shownCurrent) {
        shownCurrent?.removeAttribute('data-current')
        current?.setAttribute('data-current', '')
        shownCurrent = current
      }
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
          <div ref={bar} className="h-1 w-0 rounded-full bg-chord" />
        </div>
      </div>
      <div ref={ref} className="stage flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 pb-[70vh] pt-[18vh]">
          <ChordTipContext.Provider value={stageTips}>
            <SheetView doc={c.doc} options={{ ...c.options, fontSize: c.options.fontSize + 7 }} now={c.now} onChordClick={c.playFrom} className="font-bold" />
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
    const pxPerSecond = speed * 7
    // Phones, scrolling the page: glide it with a transform instead.
    // WebKit on iPhone moves a script-scrolled page in uneven steps however
    // it's done; a transform animation runs on the compositor and doesn't.
    const page = document.querySelector<HTMLElement>('[data-page]')
    // (Phone widths only: wider layouts have a sticky sidebar the transform
    // would carry off. localStorage leadsheet:glide = 1 forces it, for testing.)
    const phone = window.matchMedia('(pointer: coarse) and (max-width: 1023px)').matches
    const forced = (() => {
      try {
        return localStorage.getItem('leadsheet:glide') === '1'
      } catch {
        return false
      }
    })()
    if (!target && page && (phone || forced) && 'animate' in page) {
      return glide(page, pxPerSecond, () => end.current())
    }
    // Scroll in device pixels, tracking the position exactly. Whole CSS
    // pixels at ~20 px/s meant a visible jump every few frames.
    const dpr = window.devicePixelRatio || 1
    const el = target?.current ?? null
    const get = () => (el ? el.scrollTop : window.scrollY)
    const set = (y: number) => (el ? (el.scrollTop = y) : window.scrollTo(0, y))
    const atEnd = () =>
      el ? el.scrollTop + el.clientHeight >= el.scrollHeight - 1 : window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 1
    let pos = get()
    let wrote = pos
    let last = performance.now()
    let frame = 0
    const tick = (now: number) => {
      // Someone scrolled by hand: carry on from where they left it.
      if (Math.abs(get() - wrote) > 2) pos = get()
      pos += ((now - last) / 1000) * pxPerSecond
      last = now
      const y = Math.round(pos * dpr) / dpr
      if (y !== wrote) {
        set(y)
        wrote = y
        if (atEnd()) return end.current()
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [running, speed, target])
}

/**
 * Autoscroll on a phone: the page stays put and `page` slides up under it
 * as a linear transform animation, from here to the bottom. Touching the
 * screen hands it back as a real scroll position (same frame, no jump) and
 * it picks up again from wherever the finger leaves it. Returns a stop
 * function that does the same handover.
 */
function glide(page: HTMLElement, pxPerSecond: number, onEnd: () => void): () => void {
  let anim: Animation | null = null
  let from = 0 // scroll position the current glide started at
  let resume = 0

  const offset = () => {
    if (!anim) return 0
    const t = Number(anim.currentTime ?? 0) / 1000
    return Math.min(t * pxPerSecond, Number(anim.effect?.getTiming().duration ?? 0) / 1000 * pxPerSecond)
  }
  // Swap the transform for the scroll position it stood for.
  const settle = () => {
    if (!anim) return
    const y = from + offset()
    anim.cancel()
    anim = null
    page.style.willChange = ''
    window.scrollTo(0, y)
  }
  const start = () => {
    clearTimeout(resume)
    from = window.scrollY
    const distance = document.documentElement.scrollHeight - window.innerHeight - from
    if (distance <= 1) return onEnd()
    page.style.willChange = 'transform'
    anim = page.animate([{ transform: 'translate3d(0, 0, 0)' }, { transform: `translate3d(0, ${-distance}px, 0)` }], {
      duration: (distance / pxPerSecond) * 1000,
      easing: 'linear',
      fill: 'forwards',
    })
    anim.onfinish = () => {
      settle()
      onEnd()
    }
  }
  // A finger on the screen takes over; lifting it hands back.
  const grab = () => {
    clearTimeout(resume)
    settle()
  }
  const release = () => {
    clearTimeout(resume)
    // Let a flick's momentum finish before gliding on.
    resume = window.setTimeout(start, 600)
  }
  window.addEventListener('touchstart', grab, { passive: true })
  window.addEventListener('touchend', release, { passive: true })
  window.addEventListener('touchcancel', release, { passive: true })
  start()
  return () => {
    clearTimeout(resume)
    window.removeEventListener('touchstart', grab)
    window.removeEventListener('touchend', release)
    window.removeEventListener('touchcancel', release)
    settle()
  }
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

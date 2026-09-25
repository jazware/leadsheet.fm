import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { ChevronDown, FileUp, Trash2 } from 'lucide-react'
import { api, profilePath, sheetInput, sheetPath, type Sheet, type SheetInput } from '@/lib/api'
import { chordsIn, parseChordPro, type Doc } from '@/lib/chordpro'
import { CHORDPRO_ACCEPT, fromChordProFile } from '@/lib/chordproFile'
import { chordsOverLyricsToChordPro, looksLikeChordsOverLyrics } from '@/lib/convert'
import { importDraftKey, importToSheet, looksLikeUGMarkup, readImport, ugToChordPro, type UGImport } from '@/lib/ultimateGuitar'
import { forgetSheet } from '@/lib/recent'
import { getTuning, instrumentOf, shapeStrings, tuningsFor } from '@/lib/tunings'
import { useViewer } from '@/hooks/queries'
import { usePref } from '@/hooks/usePref'
import { useLogin } from '@/components/login'
import { SheetView } from '@/components/SheetView'
import { ChordTipContext } from '@/components/ChordTip'
import { handleText } from '@/components/Author'
import { ChordDiagram } from '@/components/ChordDiagram'
import { ChordSoundContext, chordKey, pickKey, readPicks, sheetShapes, SheetShapesProvider, useEditShape, useVoicing } from '@/components/Voicings'
import { fretsText, parseFrets, toRecordFrets, type Frets } from '@/lib/guitar'
import { parseChord, symbolText, type ChordSymbol } from '@/lib/music'
import { isWebLink } from '@/lib/links'
import type { SheetVoicing } from '@/lib/api'

const EMPTY: SheetInput = {
  title: '',
  artist: '',
  album: '',
  kind: 'chords',
  content: '',
  key: '',
  capo: 0,
  tuning: 'standard',
  difficulty: '',
  description: '',
  tags: [],
  voicings: [],
  links: [],
}

const EXAMPLE = `[Verse 1]
[G]Here's a line with [D]chords in [Em]brackets
[C]right before the [G]syllable they land on

[Chorus]
[C]Paste a sheet with chords on the [G]line above the lyrics
and Leadsheet will offer to [D]turn it into this`

const KINDS = [
  ['chords', 'Chords'],
  ['tab', 'Tab'],
  ['ukulele', 'Ukulele'],
  ['bass', 'Bass'],
  ['piano', 'Piano'],
] as const

const fromSheet = sheetInput

/** New sheet (/new, /new?fork=did/rkey) or edit (/sheet/:actor/:rkey/edit). */
export function EditorPage() {
  const { actor, rkey } = useParams()
  const [params] = useSearchParams()
  const fork = params.get('fork')
  const [srcActor, srcRkey] = actor && rkey ? [actor, rkey] : fork ? fork.split('/') : []
  const mode: 'new' | 'edit' | 'fork' = actor ? 'edit' : fork ? 'fork' : 'new'
  // A sheet sent over by the Ultimate Guitar bookmarklet, in the URL fragment.
  const [imported] = useState(() => (mode === 'new' ? readImport(window.location.hash) : null))
  useEffect(() => {
    if (imported) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
  }, [imported])

  const src = useQuery({
    queryKey: ['sheet', srcActor, srcRkey],
    queryFn: () => api.sheet(srcActor!, srcRkey!),
    enabled: !!srcActor && !!srcRkey,
  })
  if (srcActor && src.isLoading) return <p className="pt-4 font-semibold text-ink-soft">Loading…</p>
  if (srcActor && !src.data) return <p className="pt-4 font-bold">{src.error?.message ?? 'Sheet not found'}</p>

  const source = src.data?.sheet
  const draftKey = `leadsheet:draft:${
    mode === 'edit' ? source!.uri : mode === 'fork' ? `fork:${source!.uri}` : imported ? importDraftKey(imported) : 'new'
  }`
  return (
    <Editor
      key={draftKey}
      mode={mode}
      source={source}
      draftKey={draftKey}
      imported={imported ?? undefined}
    />
  )
}

function Editor({
  mode,
  source,
  draftKey,
  imported,
}: {
  mode: 'new' | 'edit' | 'fork'
  source?: Sheet
  draftKey: string
  imported?: UGImport
}) {
  const viewer = useViewer()
  const openLogin = useLogin()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const textarea = useRef<HTMLTextAreaElement>(null)

  // Drafts live in localStorage so signing in (a full-page OAuth
  // redirect) or a closed tab doesn't lose work. An edit draft remembers
  // the version it started from and is dropped once the sheet has changed
  // since, so a stale draft can't overwrite a newer edit.
  const base = mode === 'edit' ? source!.cid : null
  // Forking or editing carries over the shapes the reader picked while
  // looking at the sheet.
  const initial = () => (source ? withPicks(fromSheet(source), source.uri) : imported ? importToSheet(imported) : EMPTY)
  const [form, setForm] = useState<SheetInput>(() => {
    try {
      const raw = localStorage.getItem(draftKey)
      const saved = raw ? JSON.parse(raw) : null
      if (saved && typeof saved === 'object' && 'form' in saved) {
        if (saved.base === base) return { ...saved.form, voicings: saved.form.voicings ?? [], links: saved.form.links ?? [] }
      } else if (saved && base === null) {
        return { ...saved, voicings: saved.voicings ?? [], links: saved.links ?? [] } // a draft saved before drafts recorded their base
      }
    } catch {
      // ignore unreadable drafts
    }
    return initial()
  })
  const [tagText, setTagText] = useState(form.tags.join(', '))
  const [pastedLayout, setPastedLayout] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify({ base, form }))
    } catch {
      // storage unavailable
    }
  }, [draftKey, base, form])

  const set = <K extends keyof SheetInput>(k: K, v: SheetInput[K]) => setForm((f) => ({ ...f, [k]: v }))
  const doc = useMemo(() => parseChordPro(form.content || EXAMPLE), [form.content])
  // Piano has no strings: no tuning or capo to set.
  const fretted = form.kind !== 'piano'
  const tuning = getTuning(form.tuning, form.kind)
  const strings = fretted ? shapeStrings(tuning) : []
  // Stepping through a chord's shapes in the editor (preview tooltips or
  // the Shapes list) sets the sheet's own shape for it.
  const shapes = useMemo(
    () => ({
      shapes: sheetShapes(form.voicings),
      scope: 'editor',
      edit: (key: string, frets: Frets | null) =>
        setForm((f) => {
          const rest = f.voicings.filter((v) => {
            const sym = parseChord(v.chord)
            return !sym || chordKey(sym) !== key
          })
          const chord = chordsIn(parseChordPro(f.content)).find((c) => chordKey(c) === key)
          if (!frets || !chord) return { ...f, voicings: rest }
          return { ...f, voicings: [...rest, { chord: written(chord), frets: toRecordFrets(frets) }] }
        }),
    }),
    [form.voicings],
  )
  const mine = mode !== 'edit' || viewer?.did === source?.did
  const ready = form.title.trim() && form.artist.trim() && form.content.trim()

  // Either way at any time: publish (or publish changes), or keep it as a
  // draft, which also takes a published sheet back off Leadsheet's lists.
  const published = mode === 'edit' && !source?.draft
  const publish = async (draft = false) => {
    if (!viewer) {
      openLogin(draft ? 'Sign in to save a draft to your account. It stays in this browser while you do.' : 'Sign in to publish. Your draft is kept while you do.')
      return
    }
    setBusy(true)
    setError(null)
    const input: SheetInput = {
      ...form,
      draft,
      tags: tagText.split(',').map((t) => t.trim()).filter(Boolean),
      voicings: liveVoicings(form.voicings, doc),
      links: form.links.map((l) => l.trim()).filter(Boolean),
      forkOf: mode === 'fork' ? { uri: source!.uri, cid: source!.cid } : undefined,
    }
    try {
      const res =
        mode === 'edit' ? await api.updateSheet(source!.did, source!.rkey, input) : await api.createSheet(input)
      localStorage.removeItem(draftKey)
      qc.invalidateQueries()
      navigate(sheetPath({ did: res.did, rkey: res.rkey, author: viewer }))
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const remove = async () => {
    try {
      await api.deleteSheet(source!.did, source!.rkey)
      localStorage.removeItem(draftKey)
      forgetSheet(source!.did, source!.rkey)
      qc.invalidateQueries()
      navigate(viewer ? profilePath(viewer) : '/')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const discard = () => {
    localStorage.removeItem(draftKey)
    const fresh = initial()
    setForm(fresh)
    setTagText(fresh.tags.join(', '))
  }

  const convert = () => {
    set('content', looksLikeUGMarkup(form.content) ? ugToChordPro(form.content) : chordsOverLyricsToChordPro(form.content))
    setPastedLayout(false)
  }

  // Opening a ChordPro (or text) file: its fields and sheet replace the
  // form's, with the old form kept for Undo.
  const fileInput = useRef<HTMLInputElement>(null)
  const [opened, setOpened] = useState<{ name: string; prev?: SheetInput; moreSongs?: boolean; error?: string } | null>(null)
  const openFile = async (file: File) => {
    if (file.size > 1_000_000) return setOpened({ name: file.name, error: "it's too big to be a sheet" })
    const { fields, content, moreSongs } = fromChordProFile(await file.text())
    if (!content.trim()) return setOpened({ name: file.name, error: "there's no sheet in it" })
    const prev = form
    setForm((f) => {
      const next = { ...f, ...fields, content }
      // A tuning or capo the instrument can't have goes, as when picking one.
      if (!tuningsFor(next.kind).some((t) => t.id === next.tuning)) next.tuning = 'standard'
      if (next.kind === 'piano' || next.kind === 'bass') next.capo = 0
      return next
    })
    setPastedLayout(false)
    setOpened({ name: file.name, prev, moreSongs })
  }

  const insert = (snippet: string) => {
    const el = textarea.current
    const at = el ? el.selectionStart : form.content.length
    const before = form.content.slice(0, at)
    const pad = before && !before.endsWith('\n') ? '\n' : ''
    set('content', before + pad + snippet + form.content.slice(at))
    requestAnimationFrame(() => el?.focus())
  }

  if (!mine) {
    return (
      <p className="pt-4 font-bold">
        You can only edit your own sheets.{' '}
        <Link className="text-chord underline" to={`/new?fork=${encodeURIComponent(`${source!.did}/${source!.rkey}`)}`}>
          Fork it
        </Link>{' '}
        to make your own version.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-5 pt-1">
      <div>
        <h1 className="text-3xl font-black tracking-tight">
          {mode === 'edit' ? `Edit ${source!.title}` : mode === 'fork' ? `Your version of ${source!.title}` : 'New sheet'}
          {mode === 'edit' && (
            <span className={clsx('pill ml-3 align-middle text-sm', source!.draft ? 'bg-glow text-glow-ink' : 'bg-surface text-ink-soft')}>
              {source!.draft ? 'Draft' : 'Published'}
            </span>
          )}
        </h1>
        {mode === 'new' && !imported && (
          <p className="mt-1 font-semibold text-ink-soft">
            Have it on Ultimate Guitar?{' '}
            <Link className="font-extrabold text-chord hover:underline" to="/import">
              Import it
            </Link>
            .
          </p>
        )}
        {imported && (
          <p className="mt-2 rounded-2xl bg-glow px-4 py-2.5 font-bold text-glow-ink">
            Imported from{' '}
            {/* The import comes from the page's own link, so its URL is anyone's: only link a web page. */}
            {isWebLink(imported.url) ? (
              <a className="underline" href={imported.url} target="_blank" rel="noreferrer">
                Ultimate Guitar
              </a>
            ) : (
              'Ultimate Guitar'
            )}
            {imported.author && <> (transcribed by {imported.author})</>}. Check the chords line up, then publish. Nothing
            is shared until you do.
          </p>
        )}
        {mode === 'fork' && (
          <p className="mt-1 font-semibold text-ink-soft">
            Starting from{' '}
            <Link className="font-extrabold text-chord hover:underline" to={sheetPath(source!)}>
              {handleText(source!.author)}'s sheet
            </Link>
            . Yours will link back to it.
          </p>
        )}
      </div>

      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Song title" className="lg:col-span-2">
          <input className="field" value={form.title} onChange={(e) => set('title', e.target.value)} required />
        </Field>
        <Field label="Artist">
          <input className="field" value={form.artist} onChange={(e) => set('artist', e.target.value)} required />
        </Field>
        <Field label="Album (optional)">
          <input className="field" value={form.album} onChange={(e) => set('album', e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <span className="label">Type</span>
          <div role="radiogroup" aria-label="Type" className="flex gap-1 rounded-full bg-surface p-1">
            {KINDS.map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={form.kind === k}
                onClick={() =>
                  // A tuning the new instrument doesn't have goes back to its standard.
                  setForm((f) => ({
                    ...f,
                    kind: k,
                    tuning: tuningsFor(k).some((t) => t.id === f.tuning) ? f.tuning : 'standard',
                    capo: k === 'piano' || k === 'bass' ? 0 : f.capo,
                  }))
                }
                className={clsx(
                  'h-10 flex-1 rounded-full text-sm font-extrabold',
                  form.kind === k ? 'bg-ink text-bg' : 'text-ink-soft hover:text-ink',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className={clsx('grid gap-3', fretted && form.kind !== 'bass' ? 'grid-cols-[1fr_6.5rem]' : 'grid-cols-1')}>
          <Field label="Key of the chords">
            <input className="field" placeholder="G" value={form.key} onChange={(e) => set('key', e.target.value)} />
          </Field>
          {fretted && form.kind !== 'bass' && (
          <Field label="Capo">
            <input
              className="field"
              type="number"
              inputMode="numeric"
              min={0}
              max={12}
              value={form.capo}
              onChange={(e) => set('capo', Math.max(0, Math.min(12, Number(e.target.value) || 0)))}
            />
          </Field>
          )}
        </div>
        <div className={clsx('grid gap-3', fretted ? 'grid-cols-2' : 'grid-cols-1')}>
          {fretted && (
            <Field label="Tuning">
              <select className="field" value={form.tuning} onChange={(e) => set('tuning', e.target.value)}>
                {tuningsFor(form.kind).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Difficulty">
            <select className="field" value={form.difficulty} onChange={(e) => set('difficulty', e.target.value)}>
              <option value="">Not set</option>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </Field>
        </div>
      </div>

      <div role="tablist" className="flex w-max gap-1 rounded-full bg-surface p-1 lg:hidden">
        {(['write', 'preview'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={clsx('h-9 rounded-full px-4 text-sm font-extrabold capitalize', tab === t ? 'bg-ink text-bg' : 'text-ink-soft')}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <div className={clsx('flex flex-col gap-3', tab !== 'write' && 'hidden lg:flex')}>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm" onClick={() => fileInput.current?.click()} title="Open a ChordPro or text file">
              <FileUp className="h-4 w-4" aria-hidden />
              Open file
            </button>
            <input
              ref={fileInput}
              type="file"
              accept={CHORDPRO_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = '' // so the same file can be opened again
                if (file) void openFile(file)
              }}
            />
            <button type="button" className="btn btn-sm" onClick={convert}>
              Put chords inline
            </button>
            <button type="button" className="btn btn-sm" onClick={() => insert('[Chorus]\n')}>
              Section
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() =>
                insert('{start_of_tab}\ne|-----------------|\nB|-----------------|\nG|-----------------|\nD|-----------------|\nA|-----------------|\nE|-----------------|\n{end_of_tab}\n')
              }
            >
              Tab block
            </button>
            <button type="button" className="btn btn-sm" onClick={() => insert('{comment: }\n')}>
              Note
            </button>
          </div>
          {opened && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-glow px-4 py-2.5 font-bold text-glow-ink" role="status">
              <span className="min-w-0 break-words">
                {opened.error
                  ? `Couldn't open ${opened.name}: ${opened.error}.`
                  : `Opened ${opened.name}${opened.moreSongs ? ". It has more songs; this is the first" : ''}.`}
              </span>
              <span className="flex gap-2">
                {opened.prev && (
                  <button
                    type="button"
                    className="h-9 rounded-full bg-glow-ink px-4 text-sm font-extrabold text-glow"
                    onClick={() => {
                      setForm(opened.prev!)
                      setOpened(null)
                    }}
                  >
                    Undo
                  </button>
                )}
                <button type="button" className="h-9 px-2 text-sm underline" onClick={() => setOpened(null)}>
                  Dismiss
                </button>
              </span>
            </div>
          )}
          {pastedLayout && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-glow px-4 py-2.5 font-bold text-glow-ink">
              <span>Chords are above the lyrics. Put them inline?</span>
              <span className="flex gap-2">
                <button type="button" className="h-9 rounded-full bg-glow-ink px-4 text-sm font-extrabold text-glow" onClick={convert}>
                  Convert
                </button>
                <button type="button" className="h-9 px-2 text-sm underline" onClick={() => setPastedLayout(false)}>
                  Leave it
                </button>
              </span>
            </div>
          )}
          <label htmlFor="sheet-body" className="sr-only">
            Sheet
          </label>
          <textarea
            id="sheet-body"
            ref={textarea}
            className="min-h-[26rem] w-full resize-y rounded-2xl bg-surface p-4 font-mono text-[0.85rem] leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-chord"
            spellCheck={false}
            placeholder={EXAMPLE}
            value={form.content}
            onChange={(e) => set('content', e.target.value)}
            onPaste={(e) => {
              const text = e.clipboardData.getData('text')
              if (looksLikeUGMarkup(text) || looksLikeChordsOverLyrics(text)) setPastedLayout(true)
            }}
            // Dropping a file opens it.
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('Files')) e.preventDefault()
            }}
            onDrop={(e) => {
              const file = e.dataTransfer.files[0]
              if (!file) return
              e.preventDefault()
              void openFile(file)
            }}
          />
          <p className="text-sm font-semibold text-ink-soft">
            Put each [chord] in square brackets right before the syllable it's played on. A line with just [Verse]
            or [Chorus] starts a section. It's ChordPro, so {'{title: …}'} style directives work too, and you can open
            a ChordPro or text file (or drop one here).
          </p>
          <Field label="Notes for players (optional)">
            <textarea
              className="field h-auto min-h-[5.5rem] resize-y py-3"
              placeholder="Strumming pattern, how the intro riff goes, what to listen for…"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </Field>
          <LinksField links={form.links} onChange={(links) => set('links', links)} />
          <Field label="Tags, separated by commas (optional)">
            <input className="field" placeholder="acoustic, 90s, fingerpicking" value={tagText} onChange={(e) => setTagText(e.target.value)} />
          </Field>
        </div>

        <div className={clsx('min-w-0', tab !== 'preview' && 'hidden lg:block')}>
          <SheetShapesProvider value={shapes}>
            <ChordSoundContext.Provider value={{ strings: fretted ? tuning.strings : [], capo: form.capo, instrument: instrumentOf(form.kind) }}>
              {/* Saved shapes are fretted; piano voicings aren't part of a sheet. */}
              {fretted && form.content.trim() && (
                <ShapesEditor doc={doc} strings={strings} count={liveVoicings(form.voicings, doc).length} />
              )}
              <div className="label">Preview{!form.content && ' of the example'}</div>
              <div className={clsx('rounded-[20px] border-2 border-surface p-5', !form.content && 'opacity-60')}>
                <ChordTipContext.Provider value={{ strings, instrument: instrumentOf(form.kind) }}>
                  <SheetView doc={doc} options={{ shift: 0, flats: false, simplify: false, fontSize: 18 }} />
                </ChordTipContext.Provider>
              </div>
            </ChordSoundContext.Provider>
          </SheetShapesProvider>
        </div>
      </div>

      {mode === 'edit' && (
        <div className="flex flex-wrap items-center gap-2">
          {confirmDelete ? (
            <>
              <button type="button" className="btn bg-chord text-bg" onClick={remove}>
                Delete for good
              </button>
              <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                Keep it
              </button>
            </>
          ) : (
            <button type="button" className="btn text-ink-soft" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" aria-hidden />
              Delete this sheet
            </button>
          )}
        </div>
      )}

      <div className="sticky bottom-0 -mx-5 flex flex-wrap items-center gap-3 border-t border-rule bg-bg px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:-mx-8 sm:px-8">
        <button type="button" className="btn btn-accent" disabled={busy || !ready} onClick={() => publish(false)}>
          {busy ? 'Saving…' : published ? 'Publish changes' : 'Publish'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || !ready}
          onClick={() => publish(true)}
          title={
            published
              ? "Takes it off Leadsheet's lists and search until you publish it again. Ratings and saves are kept."
              : "Saved to your account but not listed on Leadsheet. Like everything in an atproto account, it's still publicly readable."
          }
        >
          {published ? 'Move to drafts' : mode === 'edit' ? 'Save draft' : 'Save as draft'}
        </button>
        <button type="button" className="btn" onClick={discard}>
          {mode === 'edit' ? 'Discard changes' : 'Start over'}
        </button>
        <span className="text-sm font-semibold text-ink-soft">
          {viewer
            ? `Saved as a record in ${handleText(viewer)}'s atproto account. Drafts aren't listed on Leadsheet, but like any record anyone can read them.`
            : 'Unsaved changes stay in this browser until you sign in and save.'}
        </span>
        {error && <p className="basis-full text-sm font-bold text-chord">{error}</p>}
      </div>
    </div>
  )
}

/** A chord as the sheet writes it, for a voicing's `chord`. */
function written(c: ChordSymbol): string {
  return symbolText(c, c.flat)
}

/** Only the voicings for chords still in the sheet, one each. */
function liveVoicings(voicings: SheetVoicing[], doc: Doc): SheetVoicing[] {
  const own = sheetShapes(voicings)
  return chordsIn(doc).flatMap((c) => {
    const frets = own.get(chordKey(c))
    if (!frets) return []
    own.delete(chordKey(c))
    return [{ chord: written(c), frets: toRecordFrets(frets) }]
  })
}

/**
 * The sheet's voicings plus the shapes this browser picked for its chords
 * (for the sheet's own chords, only picks made on that sheet).
 */
function withPicks(input: SheetInput, uri: string): SheetInput {
  const picks = readPicks()
  const strings = shapeStrings(getTuning(input.tuning, input.kind))
  const own = sheetShapes(input.voicings)
  const voicings = [...input.voicings]
  for (const c of chordsIn(parseChordPro(input.content))) {
    const key = chordKey(c)
    const pick = picks[pickKey(strings, c, own.has(key) ? uri : undefined)]
    if (!pick) continue
    const frets = toRecordFrets(pick.split(',').map((f) => (f === 'x' ? null : Number(f))))
    const at = voicings.findIndex((v) => {
      const sym = parseChord(v.chord)
      return sym && chordKey(sym) === key
    })
    if (at >= 0) voicings[at] = { ...voicings[at], frets }
    else voicings.push({ chord: written(c), frets })
  }
  return { ...input, voicings }
}

/**
 * Every chord in the sheet with its shape: arrows step through the ones
 * we know, or type any shape ("x32010", "8 10 10 9 8 8"). Chosen shapes
 * are saved with the sheet.
 */
function ShapesEditor({ doc, strings, count }: { doc: Doc; strings: number[]; count: number }) {
  const [open, setOpen] = usePref('editorShapesOpen', false)
  const chords = chordsIn(doc)
  if (!chords.length) return null
  return (
    <section className="mb-5 rounded-[20px] bg-surface">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
        aria-controls="editor-shapes"
        onClick={() => setOpen(!open)}
      >
        <span>
          <span className="font-black">Chord shapes</span>
          <span className="ml-2 text-sm font-semibold text-ink-soft">
            {count ? `${count} of ${chords.length} set by you` : `${chords.length} chords`}
          </span>
        </span>
        <ChevronDown className={clsx('h-5 w-5 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div id="editor-shapes" className="px-4 pb-4">
          <p className="mb-3 text-sm font-semibold text-ink-soft">
            How you play each chord, saved with the sheet. Step through the arrows or type frets, one per string as
            the box draws them, left to right (x = not played). A dot marks a shape you've set. Click a box to hear it.
          </p>
          <div className="flex flex-wrap gap-3">
            {chords.map((c) => (
              <ShapeField key={chordKey(c)} chord={c} strings={strings} />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function ShapeField({ chord, strings }: { chord: ChordSymbol; strings: number[] }) {
  const label = written(chord)
  const { voicing, own } = useVoicing(chord, strings)
  const edit = useEditShape()
  const current = voicing ? fretsText(voicing.frets) : ''
  const [text, setText] = useState<string | null>(null)
  const bad = text !== null && text.trim() !== '' && !parseFrets(text, strings.length)
  return (
    <div className="flex w-[4.9rem] flex-col gap-1.5">
      <ChordDiagram chord={chord} label={label} flats={chord.flat} strings={strings} cycle />
      <input
        className={clsx('field h-8 px-2 text-center font-mono text-xs', bad && 'ring-2 ring-chord')}
        aria-label={`${label} frets`}
        aria-invalid={bad || undefined}
        placeholder={current || 'x32010'}
        value={text ?? (own ? current : '')}
        onFocus={() => setText(own ? current : '')}
        onChange={(e) => {
          setText(e.target.value)
          const frets = parseFrets(e.target.value, strings.length)
          if (frets) edit(chordKey(chord), frets)
          else if (!e.target.value.trim()) edit(chordKey(chord), null)
        }}
        onBlur={() => setText(null)}
      />
    </div>
  )
}

/** Up to five links to the recording: one box per link, and an empty one to add another. */
function LinksField({ links, onChange }: { links: string[]; onChange: (links: string[]) => void }) {
  const boxes = links.length < 5 ? [...links, ''] : links
  return (
    <div>
      <span className="label">Where to hear it (optional)</span>
      <div className="flex flex-col gap-2">
        {boxes.map((l, i) => {
          const bad = l.trim() !== '' && !isWebLink(l.trim())
          return (
            <div key={i}>
              <input
                className={clsx('field', bad && 'ring-2 ring-chord')}
                type="url"
                inputMode="url"
                aria-label={`Link ${i + 1} to the recording`}
                aria-invalid={bad || undefined}
                placeholder={i === 0 ? 'A YouTube, Bandcamp, SoundCloud or Spotify link' : 'Another link'}
                value={l}
                onChange={(e) => {
                  const next = [...boxes]
                  next[i] = e.target.value
                  // Clearing a box removes that link; there's always an empty box to add one.
                  onChange(next.filter((v) => v !== ''))
                }}
              />
              {bad && <p className="mt-1 text-sm font-bold text-chord">Links start with https://</p>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={clsx('block', className)}>
      <span className="label">{label}</span>
      {children}
    </label>
  )
}

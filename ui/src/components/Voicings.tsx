import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { usePref } from '@/hooks/usePref'
import { fretsKey, fromRecordFrets, shapesFor, voicingFromFrets, type Frets, type Voicing } from '@/lib/guitar'
import { parseChord, type ChordSymbol } from '@/lib/music'
import type { SheetVoicing } from '@/lib/api'
import type { Instrument } from '@/lib/tunings'
import { pianoKey, pianoVoicings, type PianoVoicing } from '@/lib/piano'

type ChordLike = Pick<ChordSymbol, 'root' | 'quality' | 'suffix'> & { bass?: number | null }

/**
 * How a chord is looked up: its root and quality (or its suffix when we
 * don't know the quality), and a slash chord's bass: Em7/D and Em7/G are
 * different chords with different shapes.
 */
export const chordKey = (c: ChordLike) =>
  `${c.root}:${c.quality ?? `?${c.suffix}`}${c.bass !== undefined && c.bass !== null && c.bass !== c.root ? `/${c.bass}` : ''}`

/**
 * Which voicing the reader picked for each chord (and tuning), remembered
 * in this browser as frets, so the tooltip and the Shapes panel agree.
 * Picks for chords a sheet defines are kept per sheet.
 */
const PickContext = createContext<{ picks: Record<string, string>; pick: (key: string, frets: string | null) => void }>({
  picks: {},
  pick: () => {},
})

const PICKS = 'voicingPicks'

export function VoicingProvider({ children }: { children: ReactNode }) {
  const [picks, setPicks] = usePref<Record<string, string>>(PICKS, {})
  const pick = useCallback(
    (key: string, frets: string | null) => {
      const next = { ...picks }
      if (frets === null) delete next[key]
      else next[key] = frets
      setPicks(next)
    },
    [picks, setPicks],
  )
  return <PickContext.Provider value={{ picks, pick }}>{children}</PickContext.Provider>
}

/** The picks, outside React (to carry them into a fork). */
export function readPicks(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(`leadsheet:${PICKS}`) ?? '{}') ?? {}
  } catch {
    return {}
  }
}

export const pickKey = (strings: number[], c: ChordLike, scope?: string) =>
  `${scope ? `${scope}|` : ''}${strings.join(',')}|${chordKey(c)}`

/**
 * A sheet's own voicings, for the chords as displayed. In the editor,
 * `edit` is set and stepping through shapes changes the sheet instead of
 * the reader's picks.
 */
export interface SheetShapes {
  shapes: Map<string, Frets>
  /** Keeps the reader's picks for this sheet's own chords apart from their global ones. */
  scope: string
  edit?: (key: string, frets: Frets | null) => void
}
const SheetShapesContext = createContext<SheetShapes | null>(null)

export function sheetShapes(voicings: SheetVoicing[] | undefined): Map<string, Frets> {
  const out = new Map<string, Frets>()
  for (const v of voicings ?? []) {
    const c = parseChord(v.chord)
    if (c && !out.has(chordKey(c))) out.set(chordKey(c), fromRecordFrets(v.frets))
  }
  return out
}

/** In the editor: set (or with null, clear) the sheet's own shape for a chord. */
export function useEditShape(): (key: string, frets: Frets | null) => void {
  const edit = useContext(SheetShapesContext)?.edit
  if (!edit) throw new Error('useEditShape outside an editing SheetShapesProvider')
  return edit
}

export function SheetShapesProvider({ value, children }: { value: SheetShapes | null; children: ReactNode }) {
  return <SheetShapesContext.Provider value={value}>{children}</SheetShapesContext.Provider>
}

/** A chord's shapes, the sheet's own first when it has one. */
/**
 * A chord's shapes in a fixed order: the ones we know, with the sheet's
 * own first only if it isn't one of them. (Moving it to the front would
 * reshuffle the list, and the numbering, every time it changed.)
 */
export function shapesList(chord: ChordLike, strings: number[], own: Frets | undefined): Voicing[] {
  const generated = chord.quality ? shapesFor({ root: chord.root, quality: chord.quality, bass: chord.bass }, strings) : []
  if (!own) return generated
  const ownKey = fretsKey(own)
  return generated.some((v) => fretsKey(v.frets) === ownKey) ? generated : [voicingFromFrets(own), ...generated]
}

/** Which shape shows by default: the sheet's own, else the first. */
export const defaultIndex = (shapes: Voicing[], own: Frets | undefined) =>
  own ? Math.max(0, shapes.findIndex((v) => fretsKey(v.frets) === fretsKey(own))) : 0

/**
 * The shape a chord box shows for this chord: the reader's pick, else the
 * sheet's own, else the easiest. The same answer as useVoicing, for code
 * outside the boxes (playing the whole chart).
 */
export function resolveVoicing(
  chord: ChordLike,
  strings: number[],
  sheet: SheetShapes | null,
  picks: Record<string, string>,
): Voicing | undefined {
  const own = sheet?.shapes.get(chordKey(chord))
  const shapes = shapesList(chord, strings, own)
  const pick = sheet?.edit ? undefined : picks[pickKey(strings, chord, own ? sheet!.scope : undefined)]
  return shapes.find((v) => pick !== undefined && fretsKey(v.frets) === pick) ?? shapes[defaultIndex(shapes, own)]
}

/** The reader's picks (see VoicingProvider). */
export const usePicks = () => useContext(PickContext).picks

/**
 * A chord's voicings (the sheet's own first, if it has one), the one to
 * show, and a way to step through them.
 */
export function useVoicing(chord: ChordLike | null, strings: number[]) {
  const { picks, pick } = useContext(PickContext)
  const sheet = useContext(SheetShapesContext)
  const key = chord ? chordKey(chord) : ''
  const own = chord ? sheet?.shapes.get(key) : undefined
  const quality = chord?.quality ?? null
  const root = chord?.root ?? 0
  const suffix = chord?.suffix ?? ''
  const bass = chord?.bass ?? null
  const ownKey = own ? fretsKey(own) : ''
  const shapes: Voicing[] = useMemo(
    () => (chord ? shapesList({ root, quality, suffix, bass }, strings, own) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [quality, root, suffix, bass, strings.join(','), ownKey],
  )

  const storeKey = chord ? pickKey(strings, chord, own ? sheet!.scope : undefined) : ''
  const picked = sheet?.edit ? -1 : shapes.findIndex((v) => fretsKey(v.frets) === picks[storeKey])
  const fallback = defaultIndex(shapes, own)
  const index = picked >= 0 ? picked : fallback
  const step = (d: number) => {
    if (shapes.length < 2 || !chord) return
    const next = shapes[(index + d + shapes.length) % shapes.length]
    if (sheet?.edit) {
      // Back to what the app would show anyway: nothing to store.
      const generated0 = quality ? shapesFor({ root, quality, bass }, strings)[0] : undefined
      sheet.edit(key, generated0 && fretsKey(next.frets) === fretsKey(generated0.frets) ? null : next.frets)
    } else {
      // Back to the default: nothing to remember.
      pick(storeKey, next === shapes[fallback] ? null : fretsKey(next.frets))
    }
  }
  return {
    shapes,
    index,
    voicing: shapes[index] as Voicing | undefined,
    step,
    own: !!own && fretsKey(shapes[index]?.frets ?? []) === ownKey,
  }
}

/**
 * What the chord boxes sound like when clicked: the tuning's real open
 * strings (half-step-down charts are drawn with standard shapes) and the
 * capo the reader has on. Without it, boxes are silent.
 */
export const ChordSoundContext = createContext<{ strings: number[]; capo: number; instrument: Instrument } | null>(null)

/**
 * A chord on piano: its voicings (root position and inversions), the one
 * the reader picked, and a way to step through them.
 */
export function usePianoVoicing(chord: ChordLike | null) {
  const { picks, pick } = useContext(PickContext)
  const root = chord?.root ?? 0
  const quality = chord?.quality ?? null
  const bass = chord?.bass ?? null
  const shapes = useMemo(() => (quality ? pianoVoicings({ root, quality, bass }) : []), [root, quality, bass])
  const storeKey = chord ? `piano|${chordKey(chord)}` : ''
  const picked = shapes.findIndex((v) => pianoKey(v) === picks[storeKey])
  const index = picked >= 0 ? picked : 0
  const step = (d: number) => {
    if (shapes.length < 2 || !chord) return
    const next = shapes[(index + d + shapes.length) % shapes.length]
    pick(storeKey, next === shapes[0] ? null : pianoKey(next))
  }
  return { shapes, index, voicing: shapes[index] as PianoVoicing | undefined, step }
}

/** The piano voicing a chord shows (as usePianoVoicing), for playing the whole chart. */
export function resolvePiano(chord: ChordLike, picks: Record<string, string>): PianoVoicing | undefined {
  if (!chord.quality) return undefined
  const shapes = pianoVoicings({ root: chord.root, quality: chord.quality, bass: chord.bass })
  const pick = picks[`piano|${chordKey(chord)}`]
  return shapes.find((v) => pianoKey(v) === pick) ?? shapes[0]
}

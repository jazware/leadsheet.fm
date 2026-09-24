import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { usePref } from '@/hooks/usePref'
import { fretsKey, fromRecordFrets, shapesFor, voicingFromFrets, type Frets, type Voicing } from '@/lib/guitar'
import { parseChord, type ChordSymbol } from '@/lib/music'
import type { SheetVoicing } from '@/lib/api'

type ChordLike = Pick<ChordSymbol, 'root' | 'quality' | 'suffix'>

/** How a chord is looked up: its root and quality, or its suffix when we don't know the quality. */
export const chordKey = (c: ChordLike) => `${c.root}:${c.quality ?? `?${c.suffix}`}`

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
interface SheetShapes {
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

export function SheetShapesProvider({ value, children }: { value: SheetShapes | null; children: ReactNode }) {
  return <SheetShapesContext.Provider value={value}>{children}</SheetShapesContext.Provider>
}

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
  const ownKey = own ? fretsKey(own) : ''
  const shapes: Voicing[] = useMemo(() => {
    const generated = quality ? shapesFor({ root, quality }, strings) : []
    if (!ownKey) return generated
    const mine = generated.find((v) => fretsKey(v.frets) === ownKey)
    return [mine ?? voicingFromFrets(own!), ...generated.filter((v) => fretsKey(v.frets) !== ownKey)]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality, root, strings.join(','), ownKey])

  const storeKey = chord ? pickKey(strings, chord, own ? sheet!.scope : undefined) : ''
  const picked = sheet?.edit ? -1 : shapes.findIndex((v) => fretsKey(v.frets) === picks[storeKey])
  const index = picked >= 0 ? picked : 0
  const step = (d: number) => {
    if (shapes.length < 2 || !chord) return
    const next = shapes[(index + d + shapes.length) % shapes.length]
    if (sheet?.edit) {
      // Back to what the app would show anyway: nothing to store.
      const generated0 = quality ? shapesFor({ root, quality }, strings)[0] : undefined
      sheet.edit(key, generated0 && fretsKey(next.frets) === fretsKey(generated0.frets) ? null : next.frets)
    } else {
      pick(storeKey, next === shapes[0] ? null : fretsKey(next.frets))
    }
  }
  return { shapes, index, voicing: shapes[index] as Voicing | undefined, step, own: !!own && index === 0 }
}

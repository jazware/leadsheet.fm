import { createContext, useCallback, useContext, type ReactNode } from 'react'
import { usePref } from '@/hooks/usePref'
import { shapesFor, type Voicing } from '@/lib/guitar'
import type { Chord } from '@/lib/music'

/**
 * Which voicing the reader picked for each chord (and tuning), remembered
 * in this browser, so the tooltip and the Shapes panel agree everywhere.
 */
const VoicingContext = createContext<{ picks: Record<string, number>; pick: (key: string, i: number) => void }>({
  picks: {},
  pick: () => {},
})

export function VoicingProvider({ children }: { children: ReactNode }) {
  const [picks, setPicks] = usePref<Record<string, number>>('voicings', {})
  const pick = useCallback(
    (key: string, i: number) => {
      const next = { ...picks }
      if (i === 0) delete next[key]
      else next[key] = i
      setPicks(next)
    },
    [picks, setPicks],
  )
  return <VoicingContext.Provider value={{ picks, pick }}>{children}</VoicingContext.Provider>
}

/** A chord's voicings, the one picked, and a way to step through them. */
export function useVoicing(chord: Chord | null, strings: number[]) {
  const { picks, pick } = useContext(VoicingContext)
  const shapes: Voicing[] = chord ? shapesFor(chord, strings) : []
  const key = chord ? `${strings.join(',')}|${chord.root}:${chord.quality}` : ''
  const index = shapes.length ? Math.min(picks[key] ?? 0, shapes.length - 1) : 0
  const step = (d: number) => {
    if (shapes.length > 1) pick(key, (index + d + shapes.length) % shapes.length)
  }
  return { shapes, index, voicing: shapes[index] as Voicing | undefined, step }
}

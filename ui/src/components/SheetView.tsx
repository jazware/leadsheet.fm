import { clsx } from 'clsx'
import type { Block, Doc, Line } from '@/lib/chordpro'
import { pretty, symbolText, transposeSymbol, type ChordSymbol } from '@/lib/music'
import { ChordTip } from '@/components/ChordTip'

export interface ViewOptions {
  /** Semitones to move every chord by (transpose minus capo change). */
  shift: number
  flats: boolean
  simplify: boolean
  /** Base size in px for lyrics. */
  fontSize: number
}

export function chordLabel(c: ChordSymbol, o: Pick<ViewOptions, 'shift' | 'flats' | 'simplify'>): string {
  return symbolText(transposeSymbol(c, o.shift), o.flats, o.simplify)
}

const BLOCK_LABEL: Record<Block['kind'], string | null> = {
  chorus: 'Chorus',
  bridge: 'Bridge',
  verse: null,
  tab: null,
  plain: null,
  section: null,
}

/**
 * A rendered ChordPro document: chords set above the syllable they fall
 * on. Every lyric line carries data-line so stage mode can track it.
 */
export function SheetView({ doc, options, className }: { doc: Doc; options: ViewOptions; className?: string }) {
  return (
    <div className={clsx('font-semibold', className)} style={{ fontSize: options.fontSize }}>
      {doc.blocks.map((b, i) => (
        <BlockView key={i} block={b} options={options} />
      ))}
    </div>
  )
}

function BlockView({ block, options }: { block: Block; options: ViewOptions }) {
  const label = block.label ?? BLOCK_LABEL[block.kind]
  const panel = block.kind === 'chorus'
  return (
    <section className={clsx('mb-[1.1em] break-inside-avoid', panel && '-mx-4 rounded-[20px] bg-surface px-4 pb-[0.4em] pt-3')}>
      {label && (
        <h3 className={clsx('pill mb-2.5 text-[0.72em]', panel && 'bg-bg')}>{label}</h3>
      )}
      {block.kind === 'tab' ? (
        <pre data-line className="overflow-x-auto rounded-2xl bg-surface p-3 font-mono text-[0.72em] font-normal leading-snug">
          {block.tab!.join('\n')}
        </pre>
      ) : (
        <div className="leading-tight">
          {block.lines.map((l, i) => (
            <LineView key={i} line={l} options={options} />
          ))}
        </div>
      )}
    </section>
  )
}

const chordCls = 'whitespace-nowrap text-[0.9em] font-black leading-none text-chord'

function LineView({ line, options }: { line: Line; options: ViewOptions }) {
  if (line.type === 'blank') return <div className="h-[0.9em]" />
  if (line.type === 'comment') {
    return <p className="my-1.5 text-[0.8em] font-bold italic text-ink-soft">{line.text}</p>
  }
  const hasChords = line.segments.some((s) => s.chordText !== null)
  const hasText = line.segments.some((s) => s.text.trim())
  const label = (s: (typeof line.segments)[number]) =>
    s.chordText === null ? null : s.chord ? pretty(chordLabel(s.chord, options)) : s.chordText
  // Parsed chords show their shape on hover; anything else ("N.C.", "x2") is plain text.
  const tip = (s: (typeof line.segments)[number]) =>
    s.chord ? (
      <ChordTip chord={s.chord} label={label(s)!} shift={options.shift} flats={options.flats} simplify={options.simplify} />
    ) : (
      label(s)
    )
  if (!hasText) {
    // A chord-only line (intro, turnaround): chords spaced out in a row.
    return (
      <div data-line className={clsx('my-1 flex flex-wrap gap-x-[1.2em] gap-y-1', chordCls)}>
        {line.segments.map((s, i) => (s.chordText !== null ? <span key={i}>{tip(s)}</span> : null))}
      </div>
    )
  }
  // Each chord rides on the first word after it; the rest of the words
  // are separate items so long lines wrap between words. Every item
  // reserves the chord row, so a wrapped row's chords don't land on the
  // row above.
  const row = hasChords ? 'pt-[1.1em]' : ''
  return (
    <div data-line className="mb-[0.35em] flex flex-wrap items-end">
      {line.segments.flatMap((s, i) => {
        const [head = '', ...rest] = s.text.split(/(?<= )(?=\S)/)
        const l = label(s)
        return [
          <span key={i} className={clsx('relative inline-block whitespace-pre', row)}>
            {l !== null && (
              <>
                <span className={clsx('absolute left-0 top-0', chordCls)}>{tip(s)}</span>
                {/* Keeps room for the chord when the syllable under it is shorter. */}
                <span aria-hidden className={clsx('invisible block h-0 overflow-hidden pr-[0.45em]', chordCls)}>
                  {l}
                </span>
              </>
            )}
            {head || '\u00a0'}
          </span>,
          ...rest.map((w, j) => (
            <span key={`${i}.${j}`} className={clsx('whitespace-pre', row)}>
              {w}
            </span>
          )),
        ]
      })}
    </div>
  )
}

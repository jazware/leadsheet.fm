import { clsx } from 'clsx'
import type { Block, Doc, Line, Segment } from '@/lib/chordpro'
import { pretty, symbolText, transposeSymbol, type ChordSymbol } from '@/lib/music'
import { ChordTip } from '@/components/ChordTip'
import { StrumChip } from '@/components/Strum'

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
 * on. Every lyric line carries data-line so stage mode can track it, and
 * the chord being played along to (`now`) carries data-now.
 */
export function SheetView({
  doc,
  options,
  now,
  onChordClick,
  className,
}: {
  doc: Doc
  options: ViewOptions
  now?: Segment | null
  /** A chord name was clicked; return true if that was handled (it isn't strummed then). */
  onChordClick?: (s: Segment) => boolean
  className?: string
}) {
  return (
    <div className={clsx('font-semibold', className)} style={{ fontSize: options.fontSize }}>
      {doc.blocks.map((b, i) => (
        <BlockView key={i} block={b} time={doc.meta.time} options={options} now={now} onChordClick={onChordClick} />
      ))}
    </div>
  )
}

function BlockView({
  block,
  time,
  options,
  now,
  onChordClick,
}: {
  block: Block
  time?: string
  options: ViewOptions
  now?: Segment | null
  onChordClick?: (s: Segment) => boolean
}) {
  const label = block.label ?? BLOCK_LABEL[block.kind]
  const panel = block.kind === 'chorus'
  return (
    <section className={clsx('mb-[1.1em] break-inside-avoid', panel && '-mx-4 rounded-[20px] bg-surface px-4 pb-[0.4em] pt-3')}>
      {(label || block.strum) && (
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          {label && <h3 className={clsx('pill text-[0.72em]', panel && 'bg-bg')}>{label}</h3>}
          {/* The section switches strumming pattern. */}
          {block.strum && <StrumChip change={block.strum} time={time} className={panel ? 'bg-bg' : undefined} />}
        </div>
      )}
      {block.kind === 'tab' ? (
        <pre data-line className="overflow-x-auto rounded-2xl bg-surface p-3 font-mono text-[0.72em] font-normal leading-snug">
          {block.tab!.join('\n')}
        </pre>
      ) : (
        <div className="leading-tight">
          {block.lines.map((l, i) => (
            <LineView key={i} line={l} time={time} options={options} now={now} onChordClick={onChordClick} />
          ))}
        </div>
      )}
    </section>
  )
}

const chordCls = 'whitespace-nowrap text-[0.9em] font-black leading-none text-chord'

function LineView({
  line,
  time,
  options,
  now,
  onChordClick,
}: {
  line: Line
  time?: string
  options: ViewOptions
  now?: Segment | null
  onChordClick?: (s: Segment) => boolean
}) {
  if (line.type === 'blank') return <div className="h-[0.9em]" />
  if (line.type === 'strum') {
    // Mid-section: from this line on (or for one bar, "once").
    return (
      <div className="my-1.5">
        <StrumChip change={line.change} time={time} note={line.change.once ? 'one bar' : 'from here'} />
      </div>
    )
  }
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
      <ChordTip
        chord={s.chord}
        label={label(s)!}
        shift={options.shift}
        flats={options.flats}
        simplify={options.simplify}
        onPlay={onChordClick && (() => onChordClick(s))}
      />
    ) : (
      label(s)
    )
  if (!hasText) {
    // A chord-only line (intro, turnaround): chords spaced out in a row.
    return (
      <div data-line className={clsx('my-1 flex flex-wrap gap-x-[1.2em] gap-y-1', chordCls)}>
        {line.segments.map((s, i) =>
          s.chordText !== null ? (
            <span key={i} data-now={s === now || undefined}>
              {tip(s)}
            </span>
          ) : null,
        )}
      </div>
    )
  }
  // Each chord rides on the first word after it; the rest of the words
  // are separate items so long lines wrap between words. Every item
  // reserves the chord row, so a wrapped row's chords don't land on the
  // row above. A chord in the middle of a word ("fol[G]low") splits it
  // into two items, so those are grouped back up: lines never break
  // mid-word.
  const row = hasChords ? 'pt-[1.1em]' : ''
  const words: { key: string; pieces: React.ReactNode[] }[] = []
  line.segments.forEach((s, i) => {
    const [head = '', ...rest] = s.text.split(/(?<= )(?=\S)/)
    const l = label(s)
    const prev = line.segments[i - 1]?.text ?? ''
    const midWord = i > 0 && /\S$/.test(prev) && /^\S/.test(head)
    const first = (
      <span key={i} className={clsx('relative inline-block whitespace-pre', row)}>
        {l !== null && (
          <>
            <span data-now={s === now || undefined} className={clsx('absolute left-0 top-0', chordCls)}>
              {tip(s)}
            </span>
            {/* Keeps room for the chord when the syllable under it is shorter. */}
            <span aria-hidden className={clsx('invisible block h-0 overflow-hidden pr-[0.45em]', chordCls)}>
              {l}
            </span>
          </>
        )}
        {head || '\u00a0'}
      </span>
    )
    if (midWord && words.length) words[words.length - 1].pieces.push(first)
    else words.push({ key: String(i), pieces: [first] })
    rest.forEach((w, j) =>
      words.push({
        key: `${i}.${j}`,
        pieces: [
          <span key={`${i}.${j}`} className={clsx('whitespace-pre', row)}>
            {w}
          </span>,
        ],
      }),
    )
  })
  return (
    <div data-line className="mb-[0.35em] flex flex-wrap items-end">
      {words.map((w) =>
        w.pieces.length === 1 ? (
          w.pieces[0]
        ) : (
          <span key={w.key} className="inline-flex items-end">
            {w.pieces}
          </span>
        ),
      )}
    </div>
  )
}

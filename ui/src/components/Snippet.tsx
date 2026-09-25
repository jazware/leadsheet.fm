/** Renders a search snippet, marking the matched words. */
export function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\u0002[^\u0003]*\u0003)/)
  return (
    <span className="line-clamp-2 font-semibold italic">
      “
      {parts.map((p, i) => (p.startsWith('\u0002') ? <mark key={i}>{p.slice(1, -1)}</mark> : <span key={i}>{p.replace(/\n+/g, ' / ')}</span>))}
      ”
    </span>
  )
}

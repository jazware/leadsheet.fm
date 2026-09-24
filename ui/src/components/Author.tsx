import { Link } from 'react-router-dom'
import { clsx } from 'clsx'
import { profilePath, type Author } from '@/lib/api'

export function handleText(author: Author) {
  return '@' + (author.handle || author.did.slice(0, 18) + '…')
}

export function Avatar({ author, size = 'sm' }: { author: Author; size?: 'sm' | 'md' | 'lg' }) {
  const cls = { sm: 'h-6 w-6', md: 'h-9 w-9', lg: 'h-16 w-16' }[size]
  return author.avatar ? (
    <img src={author.avatar} alt="" className={clsx(cls, 'shrink-0 rounded-full bg-surface object-cover')} />
  ) : (
    <span className={clsx(cls, 'inline-block shrink-0 rounded-full bg-glow')} aria-hidden />
  )
}

export function AuthorLink({ author }: { author: Author }) {
  return (
    <Link to={profilePath(author)} className="inline-flex items-center gap-2 font-bold hover:underline">
      <Avatar author={author} />
      <span>{author.displayName || handleText(author)}</span>
    </Link>
  )
}

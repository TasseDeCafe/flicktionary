import { Link } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { ListTree, Pin } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import type { BookGroup } from '../utils/derive-books'
import { useRelativeDateLabel } from '../hooks/use-relative-date-label'
import { MediaCard, MediaListItem, MediaThumb } from './media-card'

type Props = {
  book: BookGroup
}

// One entry per book in session lists. Tapping resumes reading: it opens the
// part read most recently, where the reader restores the saved line. The
// contents button (outside the card's Link) opens the book page. A pinned book
// leads its meta line with the same pin glyph as the book page's Prioritize card.
const useBookGroupParts = (book: BookGroup) => {
  const { t } = useLingui()
  const relativeDate = useRelativeDateLabel()
  const partTitle = book.currentSession.bookPartTitle
  const bookTitle = book.title
  const metaParts = [book.language.toUpperCase(), book.author, partTitle].filter((part): part is string => !!part)
  const renderMeta = (metaText: string) => (
    <>
      {book.pinned && <Pin aria-hidden className='mr-1 inline size-3 -translate-y-px' />}
      {metaText}
    </>
  )
  return {
    title: book.title || t`Untitled`,
    dateLabel: relativeDate(book.latestActivityAt),
    linkProps: { to: '/sessions/$sessionId', params: { sessionId: book.currentSession.id } } as const,
    ariaLabel: book.pinned ? t`Continue reading ${bookTitle}, prioritized book` : t`Continue reading ${bookTitle}`,
    media: <MediaThumb imageUrl={null} title={book.title} type='book' />,
    metaText: metaParts.join(' · '),
    renderMeta,
    action: (
      <Button
        asChild
        variant='ghost'
        size='icon'
        // Same alpha fill as the session ⋮ so it stays visible over the
        // card's hover background.
        className='text-muted-foreground hover:text-foreground hover:bg-foreground/10 active:bg-foreground/15 h-8 w-8'
      >
        <Link
          to='/sessions/book/$contentSourceId'
          params={{ contentSourceId: book.contentSourceId }}
          aria-label={t`Contents`}
        >
          <ListTree className='h-4 w-4' />
        </Link>
      </Button>
    ),
  }
}

export const BookGroupListItem = ({ book }: Props) => {
  const { title, dateLabel, linkProps, ariaLabel, media, metaText, renderMeta, action } = useBookGroupParts(book)
  return (
    <MediaListItem
      linkProps={linkProps}
      ariaLabel={ariaLabel}
      media={media}
      title={title}
      meta={renderMeta(metaText)}
      dateLabel={dateLabel}
      action={action}
    />
  )
}

export const BookGroupMediaCard = ({ book, className }: Props & { className?: string }) => {
  const { title, dateLabel, linkProps, ariaLabel, media, metaText, renderMeta, action } = useBookGroupParts(book)
  return (
    <MediaCard
      linkProps={linkProps}
      ariaLabel={ariaLabel}
      media={media}
      title={title}
      meta={renderMeta(`${metaText} · ${dateLabel}`)}
      action={action}
      className={className}
    />
  )
}

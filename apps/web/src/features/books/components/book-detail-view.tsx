import { useState } from 'react'
import { getRouteApi, useLocation, useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { BookOpen, Trash2 } from 'lucide-react'
import type { BookPart } from '@flicktionary/api-client/orpc-contracts/books-contract'
import { Button } from '@flicktionary/ui/components/button'
import { Card } from '@flicktionary/ui/components/card'
import { Skeleton, SkeletonList } from '@flicktionary/ui/components/skeleton'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import {
  ResponsiveOverlay,
  OverlayContent,
  OverlayHeader,
  OverlayTitle,
  OverlayDescription,
  OverlayFooter,
} from '@/components/ui/responsive-overlay'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { useModalScreenClose } from '@/features/navigation/hooks/use-modal-screen-close'
import { useGetBook, useOpenBookPart, useRemoveBook } from '../api/books-hooks'
import { BookPriorityCard } from './book-priority-card'
import { BookPrelearnSection } from './book-prelearn-section'

const routeApi = getRouteApi('/_authenticated/_app/sessions/book/$contentSourceId')

// Share of the part read, from the furthest-read segment (0-based index).
const readFraction = (part: BookPart): number => {
  if (part.furthestReadSegmentIndex === null || part.segmentCount === 0) return 0
  return Math.min(1, (part.furthestReadSegmentIndex + 1) / part.segmentCount)
}

const PartRowSkeleton = () => (
  <Card className='gap-2 p-3'>
    <Skeleton className='h-4 w-2/3' />
    <Skeleton className='h-1.5 w-full' />
  </Card>
)

// A book's table of contents: every part with its reading progress, the
// current part marked, and a sticky Continue that resumes at the saved line.
export const BookDetailView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { contentSourceId } = routeApi.useParams()
  const { data: book, isLoading, isError } = useGetBook(contentSourceId)
  const { mutate: openPart, isPending: isOpening, variables: openingVariables } = useOpenBookPart()
  const { mutate: removeBook, isPending: isRemoving } = useRemoveBook()
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false)
  const closeToOpener = useModalScreenClose({ to: '/sessions' })
  // Opened from a part's Contents button, this page replaced that reader: the
  // chevron steps back into the part, and picking a part replaces the page, so
  // one close from any part leaves the book. Opened from a book card (or a
  // deep link), it's a layer: parts push and the chevron returns to the opener.
  const fromSessionId = useLocation({ select: (location) => location.state.bookContentsFromSessionId })
  const close = fromSessionId
    ? () => void navigate({ to: '/sessions/$sessionId', params: { sessionId: fromSessionId }, replace: true })
    : closeToOpener
  const replace = fromSessionId !== undefined

  const goToPart = (part: BookPart) => {
    if (part.sessionId) {
      void navigate({ to: '/sessions/$sessionId', params: { sessionId: part.sessionId }, replace })
      return
    }
    openPart(
      { contentSourceId, partIndex: part.partIndex },
      {
        onSuccess: (response) =>
          void navigate({ to: '/sessions/$sessionId', params: { sessionId: response.data.sessionId }, replace }),
      }
    )
  }

  const partCount = book?.parts.length ?? 0
  const bookTitle = book?.title ?? ''
  const currentPart = book?.parts.find((part) => part.partIndex === book.currentPartIndex) ?? book?.parts[0]
  const hasStarted = book?.parts.some((part) => part.lastReadAt !== null) ?? false
  const lastPart = book?.parts[book.parts.length - 1]
  const finished = lastPart ? readFraction(lastPart) >= 1 : false

  return (
    <ModalScreen
      onClose={close}
      closeIcon='chevron'
      title={book?.title ?? t`Book`}
      rightSlot={
        book ? (
          <Button
            variant='ghost'
            size='icon'
            aria-label={t`Remove book`}
            className='text-muted-foreground hover:text-destructive h-9 w-9'
            onClick={() => setConfirmRemoveOpen(true)}
          >
            <Trash2 className='h-4 w-4' />
          </Button>
        ) : null
      }
    >
      <div className='flex-1 overflow-y-auto px-4 py-4'>
        <div className='mx-auto flex max-w-2xl flex-col gap-2'>
          {book && (
            <p className='text-muted-foreground mb-2 text-sm'>
              {[book.author, book.language.toUpperCase(), t`${partCount} parts`].filter(Boolean).join(' · ')}
            </p>
          )}
          {book && <BookPriorityCard book={book} finished={finished} />}
          {/* Above the parts so it's reachable without scrolling a long table of contents */}
          {book && (
            <div className='mb-2'>
              <BookPrelearnSection book={book} finished={finished} />
            </div>
          )}
          {isLoading && <SkeletonList count={6} renderItem={() => <PartRowSkeleton />} />}
          {isError && <p className='text-muted-foreground text-sm'>{t`This book isn't in your library.`}</p>}
          {book?.parts.map((part) => {
            const fraction = readFraction(part)
            const isCurrent = hasStarted && part.partIndex === book.currentPartIndex
            const isPartOpening = isOpening && openingVariables?.partIndex === part.partIndex
            return (
              <Card
                key={part.textTrackId}
                className={cn(
                  'hover:bg-accent active:bg-accent gap-0 py-0 transition-colors',
                  isCurrent && 'ring-foreground/30 ring-2'
                )}
              >
                <button
                  type='button'
                  disabled={isOpening}
                  onClick={() => goToPart(part)}
                  className='flex w-full flex-col gap-2 p-3 text-left'
                >
                  <div className='flex items-center gap-2'>
                    <span className='min-w-0 flex-1 truncate text-sm font-medium'>{part.title}</span>
                    {isCurrent && (
                      <span className='text-muted-foreground shrink-0 text-xs font-medium'>{t`Reading`}</span>
                    )}
                    {isPartOpening && <span className='text-muted-foreground shrink-0 text-xs'>{t`Opening…`}</span>}
                  </div>
                  <div className='bg-muted h-1.5 w-full overflow-hidden rounded-full'>
                    <div className='bg-foreground/60 h-full rounded-full' style={{ width: `${fraction * 100}%` }} />
                  </div>
                </button>
              </Card>
            )
          })}
        </div>
      </div>

      {currentPart && (
        <div className='bg-background/95 sticky right-0 bottom-0 left-0 z-10 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur'>
          <div className='mx-auto flex w-full max-w-md md:max-w-lg'>
            <Button size='xl' className='w-full' disabled={isOpening} onClick={() => goToPart(currentPart)}>
              <BookOpen />
              {hasStarted ? t`Continue reading` : t`Start reading`}
            </Button>
          </div>
        </div>
      )}

      <ResponsiveOverlay open={confirmRemoveOpen} onOpenChange={setConfirmRemoveOpen}>
        <OverlayContent>
          <OverlayHeader>
            <OverlayTitle>{t`Remove "${bookTitle}"?`}</OverlayTitle>
            <OverlayDescription>
              {t`This removes the book and its reading progress from your library. Your kept vocabulary stays in your collection.`}
            </OverlayDescription>
          </OverlayHeader>
          <OverlayFooter>
            <Button variant='outline' size='xl' onClick={() => setConfirmRemoveOpen(false)} disabled={isRemoving}>
              {t`Cancel`}
            </Button>
            <Button
              variant='destructive'
              size='xl'
              disabled={isRemoving}
              onClick={() =>
                removeBook(
                  { contentSourceId },
                  {
                    // Leave to the opener, never back into a part of the
                    // removed book (the reader-origin chevron would).
                    onSuccess: () => {
                      setConfirmRemoveOpen(false)
                      closeToOpener()
                    },
                  }
                )
              }
            >
              {isRemoving ? t`Removing…` : t`Remove`}
            </Button>
          </OverlayFooter>
        </OverlayContent>
      </ResponsiveOverlay>
    </ModalScreen>
  )
}

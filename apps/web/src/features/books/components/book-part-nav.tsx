import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { BookPart } from '@flicktionary/api-client/orpc-contracts/books-contract'
import { Button } from '@flicktionary/ui/components/button'
import { useGetBook, useOpenBookPart } from '../api/books-hooks'

type Props = {
  contentSourceId: string
  partIndex: number
}

// End-of-part navigation for a book part in the reader: continue with the next
// part (or step back). Part-to-part paging replaces the history entry, so
// closing the reader returns to wherever the book was opened from.
export const BookPartNav = ({ contentSourceId, partIndex }: Props) => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { data: book } = useGetBook(contentSourceId)
  const { mutate: openPart, isPending } = useOpenBookPart()

  if (!book) return null
  const previous = book.parts.find((part) => part.partIndex === partIndex - 1)
  const next = book.parts.find((part) => part.partIndex === partIndex + 1)
  if (!previous && !next) return null

  const nextTitle = next?.title ?? ''
  const previousTitle = previous?.title ?? ''

  const goTo = (part: BookPart) => {
    if (part.sessionId) {
      void navigate({ to: '/sessions/$sessionId', params: { sessionId: part.sessionId }, replace: true })
      return
    }
    openPart(
      { contentSourceId, partIndex: part.partIndex },
      {
        onSuccess: (response) =>
          void navigate({
            to: '/sessions/$sessionId',
            params: { sessionId: response.data.sessionId },
            replace: true,
          }),
      }
    )
  }

  return (
    <div className='mt-6 mb-4 flex flex-col gap-2'>
      {next ? (
        <Button size='xl' className='w-full' disabled={isPending} onClick={() => goTo(next)}>
          <span className='min-w-0 truncate'>{t`Next: ${nextTitle}`}</span>
          <ChevronRight />
        </Button>
      ) : (
        <p className='text-muted-foreground py-2 text-center text-sm'>{t`You've reached the end of the book.`}</p>
      )}
      {previous && (
        <Button variant='ghost' size='sm' className='self-center' disabled={isPending} onClick={() => goTo(previous)}>
          <ChevronLeft />
          <span className='min-w-0 truncate'>{t`Previous: ${previousTitle}`}</span>
        </Button>
      )}
    </div>
  )
}

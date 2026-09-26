import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Pin } from 'lucide-react'
import type { Book } from '@flicktionary/api-client/orpc-contracts/books-contract'
import { Button } from '@flicktionary/ui/components/button'
import { Card } from '@flicktionary/ui/components/card'
import { Switch } from '@flicktionary/ui/components/switch'
import {
  ResponsiveOverlay,
  OverlayContent,
  OverlayHeader,
  OverlayTitle,
  OverlayDescription,
  OverlayFooter,
} from '@/components/ui/responsive-overlay'
import { usePinBook, useRetryBookAnalysis, useUnpinBook } from '../api/books-hooks'

type BookPriorityCardProps = {
  book: Book
  // The last part is read to the end: nothing is ahead, so the boost is inert.
  finished: boolean
}

// The pinned-book toggle (docs/SRS.md §4 "Pinned book"): while on, words that
// come up often in the unread chapters get up to half of the day's new words.
// Hidden for languages without dictionary data, where pinning is refused.
export const BookPriorityCard = ({ book, finished }: BookPriorityCardProps) => {
  const { t } = useLingui()
  const { mutate: pin, isPending: isPinning } = usePinBook()
  const { mutate: unpin, isPending: isUnpinning } = useUnpinBook()
  const { mutate: retry, isPending: isRetrying } = useRetryBookAnalysis()
  const [confirmReplaceOpen, setConfirmReplaceOpen] = useState(false)

  const { priority } = book
  if (priority.analysis.status === 'unsupported') return null

  const contentSourceId = book.contentSourceId
  const replacedTitle = priority.pinnedElsewhereTitle ?? ''
  const failedPartCount = priority.analysis.failedPartCount
  const introducedToday = priority.quota?.introducedToday ?? 0
  const quota = priority.quota?.quota ?? 0

  const onCheckedChange = (checked: boolean) => {
    if (!checked) {
      unpin({ contentSourceId })
      return
    }
    if (priority.pinnedElsewhereTitle) {
      setConfirmReplaceOpen(true)
      return
    }
    pin({ contentSourceId })
  }

  const description = !priority.pinned
    ? t`Words that come up often in the chapters ahead get up to half of your new words each day.`
    : finished
      ? t`You've finished this book, so its words no longer get priority.`
      : priority.analysis.status === 'analyzing'
        ? t`Analyzing the chapters… Words from the chapters already analyzed get priority now.`
        : t`${introducedToday} of ${quota} book words introduced today. Up to half of your new words each day come from the chapters ahead.`

  return (
    <Card className='mb-2 gap-2 p-4'>
      <div className='flex items-center gap-3'>
        <Pin className='text-muted-foreground h-4 w-4 shrink-0' />
        <span className='min-w-0 flex-1 text-sm font-medium'>{t`Prioritize words from this book`}</span>
        <Switch
          checked={priority.pinned}
          disabled={isPinning || isUnpinning}
          onCheckedChange={onCheckedChange}
          aria-label={t`Prioritize words from this book`}
        />
      </div>
      <p className='text-muted-foreground text-sm'>{description}</p>
      {priority.pinned && failedPartCount > 0 && (
        <div className='flex items-center gap-3'>
          <p className='text-muted-foreground min-w-0 flex-1 text-sm'>
            {t`${failedPartCount} chapters couldn't be analyzed.`}
          </p>
          <Button variant='outline' size='sm' disabled={isRetrying} onClick={() => retry({ contentSourceId })}>
            {t`Retry`}
          </Button>
        </div>
      )}

      <ResponsiveOverlay open={confirmReplaceOpen} onOpenChange={setConfirmReplaceOpen}>
        <OverlayContent>
          <OverlayHeader>
            <OverlayTitle>{t`Prioritize this book instead?`}</OverlayTitle>
            <OverlayDescription>
              {t`Only one book per language gets priority. "${replacedTitle}" will stop getting it. Words you've already started keep their schedule.`}
            </OverlayDescription>
          </OverlayHeader>
          <OverlayFooter>
            <Button variant='outline' size='xl' onClick={() => setConfirmReplaceOpen(false)} disabled={isPinning}>
              {t`Cancel`}
            </Button>
            <Button
              size='xl'
              disabled={isPinning}
              onClick={() => pin({ contentSourceId }, { onSuccess: () => setConfirmReplaceOpen(false) })}
            >
              {t`Prioritize this book`}
            </Button>
          </OverlayFooter>
        </OverlayContent>
      </ResponsiveOverlay>
    </Card>
  )
}

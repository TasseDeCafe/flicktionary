import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Pencil } from 'lucide-react'
import type { PracticePool, ReviewTerm } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import {
  ResponsiveOverlay,
  OverlayContent,
  OverlayDescription,
  OverlayHeader,
  OverlayTitle,
} from '@/components/ui/responsive-overlay'
import { OverlayActionRow } from '@flicktionary/ui/components/overlay-action-row'
import { useGetChunk } from '@/features/review/api/review-hooks'

interface FlashcardActionsOverlayProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // The displayed card (current or peeked); null when the queue is done.
  term: ReviewTerm | null
  targetLanguage: string
  pool: PracticePool
}

// Header-kebab actions for the displayed flashcard. "Edit term" deep-links to
// the focus view via the chunk's representative-card pointer, fetched lazily
// on open (the queue's ReviewTerm payload stays lean). Same menu pattern as
// the vocabulary rows and the reading-mode rate sheet.
//
// Navigating away unmounts the flashcard queue (client-side state): the fresh
// queue on return re-fetches — already-rated cards drop out naturally and
// 'again' cards resurface as due learning-state — but in-session peek
// re-rate records don't survive the round-trip.
export const FlashcardActionsOverlay = ({
  open,
  onOpenChange,
  term,
  targetLanguage,
  pool,
}: FlashcardActionsOverlayProps) => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { data, isPending } = useGetChunk(term?.userLookupId ?? '', open && term !== null)
  const canEdit = !!data?.firstCardId && !!data?.firstCardSessionId

  if (!term) return null

  const handleEdit = () => {
    if (!data?.firstCardId || !data.firstCardSessionId) return
    onOpenChange(false)
    void navigate({
      to: '/sessions/$sessionId/review/$cardId',
      params: { sessionId: data.firstCardSessionId, cardId: data.firstCardId },
      // practiceMode: 'flashcards' routes the focus view's close back to the
      // flashcard queue instead of reading mode.
      search: {
        from: 'practice' as const,
        practiceLang: targetLanguage,
        practicePool: pool,
        practiceMode: 'flashcards' as const,
      },
    })
  }

  return (
    <ResponsiveOverlay open={open} onOpenChange={onOpenChange}>
      <OverlayContent>
        <OverlayHeader>
          <OverlayTitle>{term.headword}</OverlayTitle>
          <OverlayDescription className='sr-only'>{t`Actions for this card.`}</OverlayDescription>
        </OverlayHeader>
        <div className='flex flex-col gap-1 px-2 pb-2'>
          <OverlayActionRow
            icon={Pencil}
            label={t`Edit term`}
            description={t`Open the focus view to edit fields, chat, or generate full exploration.`}
            disabled={isPending || !canEdit}
            onClick={handleEdit}
          />
        </div>
      </OverlayContent>
    </ResponsiveOverlay>
  )
}

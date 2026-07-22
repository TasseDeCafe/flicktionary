import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Pencil } from 'lucide-react'
import type {
  PracticePool,
  PracticeQueueFilter,
} from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import {
  ResponsiveOverlay,
  OverlayContent,
  OverlayDescription,
  OverlayHeader,
  OverlayTitle,
} from '@/components/ui/responsive-overlay'
import { OverlayActionRow } from '@flicktionary/ui/components/overlay-action-row'
import { useGetChunk } from '@/features/review/api/review-hooks'

interface TermActionsOverlayProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // The term behind the displayed queue item — flashcard or exercise alike
  // (current or peeked); null when the queue is done.
  term: { userLookupId: string; headword: string } | null
  targetLanguage: string
  pool: PracticePool
  // The serving surface — routes the focus view's close back here. 'strengthen'
  // carries its bonus list, 'warmup' its session scope, so the re-entered route
  // rebuilds the same session.
  practiceMode: 'flashcards' | 'strengthen' | 'warmup'
  practiceStudySessionId?: string
  practiceSessionHard?: string[]
  // The composed queue's filter ('flashcards' mode only) — carried through the
  // focus-view URL so its close re-enters the composed route under the same
  // filter, which is what lets the stashed session snapshot match and resume.
  practiceFilter?: PracticeQueueFilter
  // The Daily Mix chain, when the session is part of one — rides the same
  // detour so returning doesn't drop the run.
  practiceMix?: string[]
}

// Header-kebab actions for the term behind the displayed composed-queue item.
// "Edit term" deep-links to the focus view via the chunk's representative-card
// pointer, fetched lazily on open (the queue payloads stay lean). Same menu
// pattern as the vocabulary rows and the reading-mode rate sheet.
//
// Navigating away unmounts the composed queue, but the session survives the
// detour: the view stashes its snapshot on unmount and the focus view's close
// re-enters the same route, where the snapshot resumes (see
// composed-session-snapshot.ts).
export const TermActionsOverlay = ({
  open,
  onOpenChange,
  term,
  targetLanguage,
  pool,
  practiceMode,
  practiceStudySessionId,
  practiceSessionHard,
  practiceFilter,
  practiceMix,
}: TermActionsOverlayProps) => {
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
      // practiceMode routes the focus view's close back to the serving surface
      // instead of reading mode.
      search: {
        from: 'practice' as const,
        practiceLang: targetLanguage,
        practicePool: pool,
        practiceMode,
        practiceStudySessionId,
        practiceSessionHard,
        practiceFilter,
        practiceMix,
      },
    })
  }

  return (
    <ResponsiveOverlay open={open} onOpenChange={onOpenChange}>
      <OverlayContent>
        <OverlayHeader>
          <OverlayTitle>{term.headword}</OverlayTitle>
          <OverlayDescription className='sr-only'>{t`Actions for this term.`}</OverlayDescription>
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

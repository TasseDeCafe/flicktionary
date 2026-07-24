import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Pencil } from 'lucide-react'
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
}

// Header-kebab actions for the term behind the displayed queue item.
// "Edit term" deep-links to the focus view via the chunk's representative-card
// pointer, fetched lazily on open (the queue payloads stay lean). Same menu
// pattern as the vocabulary rows and the reading-mode rate sheet.
//
// Navigating away unmounts the serving queue, but the session survives the
// detour: the view stashes its snapshot on unmount, and the focus view's close
// pops history back to the same route+search entry, where the snapshot resumes
// (see exercise-session-snapshot.ts).
export const TermActionsOverlay = ({ open, onOpenChange, term }: TermActionsOverlayProps) => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { data, isPending } = useGetChunk(term?.userLookupId ?? '', open && term !== null)
  const canEdit = !!data?.firstCardId && !!data.firstCardSessionId

  if (!term) return null

  const handleEdit = () => {
    if (!data?.firstCardId || !data.firstCardSessionId) return
    onOpenChange(false)
    void navigate({
      to: '/sessions/$sessionId/review/$cardId',
      params: { sessionId: data.firstCardSessionId, cardId: data.firstCardId },
      // `scope: 'language'` renders the card as a language-wide entry (kept by
      // definition, no session position counter or paging).
      search: { scope: 'language' as const },
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

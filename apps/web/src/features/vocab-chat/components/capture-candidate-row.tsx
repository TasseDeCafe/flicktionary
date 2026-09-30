import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Loader2, Pencil, Plus } from 'lucide-react'
import type { CaptureCandidate } from '@flicktionary/api-client/orpc-contracts/vocab-chat-contract'
import { Button } from '@flicktionary/ui/components/button'
import { useCreateAdhocCard } from '@/features/vocabulary/api/adhoc-hooks'
import { useMarkCandidateAdded, type CaptureSearch } from '../api/vocab-chat-hooks'
import { TermRow, TermRowStatus } from './term-row'

// A "Translate & add" candidate. Each row owns its mutation so several adds
// run in parallel (mutate-level callbacks only fire for a hook's latest call).
// Add runs the regular ad-hoc card creation; once the card exists the row
// offers Edit instead.
export const CaptureCandidateRow = ({
  candidate,
  search,
  inputLanguage,
}: {
  candidate: CaptureCandidate
  search: CaptureSearch
  inputLanguage: string | null
}) => {
  const { t } = useLingui()
  const { mutate: createAdhoc, isPending } = useCreateAdhocCard()
  const markCandidateAdded = useMarkCandidateAdded()
  // Added from this screen: labeled "Added" rather than "In your vocabulary"
  // (both point at the card).
  const [justAdded, setJustAdded] = useState(false)
  const card = candidate.existingCard

  const handleAdd = () => {
    if (isPending) return
    createAdhoc(
      {
        targetLanguage: search.targetLanguage,
        headword: candidate.headword,
        // The example is based on the learner's context when they gave one,
        // so the card keeps a trace of where they met the term.
        context: candidate.example || null,
        // Only a real translation lookup carries a meaning to steer by; a
        // target-language input is its own meaning.
        meaningHint: inputLanguage !== search.targetLanguage ? search.text : null,
      },
      {
        onSuccess: (response) => {
          markCandidateAdded({
            search,
            headword: candidate.headword,
            card: { cardId: response.data.cardId, sessionId: response.data.sessionId },
          })
          setJustAdded(true)
        },
        onError: () => toast.error(t`Failed to create card`),
      }
    )
  }

  return (
    <TermRow
      headword={candidate.headword}
      note={candidate.note}
      example={candidate.example}
      action={
        card ? (
          <>
            <TermRowStatus tone='added'>{justAdded ? t`Added` : t`In your vocabulary`}</TermRowStatus>
            <Button variant='outline' size='sm' asChild>
              <Link
                to='/sessions/$sessionId/review/$cardId'
                params={{ sessionId: card.sessionId, cardId: card.cardId }}
                search={{ scope: 'language' as const }}
              >
                <Pencil className='size-3.5' />
                {t`Edit card`}
              </Link>
            </Button>
          </>
        ) : (
          <Button variant='secondary' size='sm' onClick={handleAdd} disabled={isPending}>
            {isPending ? <Loader2 className='size-4 animate-spin' /> : <Plus className='size-4' />}
            {t`Add`}
          </Button>
        )
      }
    />
  )
}

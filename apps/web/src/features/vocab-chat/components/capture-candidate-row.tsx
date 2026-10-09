import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Loader2, Pencil, Plus } from 'lucide-react'
import type { CaptureCandidate, CaptureMatch } from '@flicktionary/api-client/orpc-contracts/vocab-chat-contract'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Button } from '@flicktionary/ui/components/button'
import { Skeleton } from '@flicktionary/ui/components/skeleton'
import { useCreateAdhocCard } from '@/features/vocabulary/api/adhoc-hooks'
import { useCaptureMatches, type CaptureSearch } from '../api/vocab-chat-hooks'
import { TermRow, TermRowStatus } from './term-row'

type CaptureCard = { cardId: string; sessionId: string }

// The candidates of one "Translate & add" search, with whether the learner
// already has each one. Rows are keyed by position: two candidates can share a
// headword with different meanings, and the cached LLM answer for a search
// never reorders.
export const CaptureCandidateList = ({
  search,
  translation,
  className,
}: {
  search: CaptureSearch
  translation: { inputLanguage: string | null; candidates: CaptureCandidate[] }
  className?: string
}) => {
  const { data: matches, isLoading: isMatching } = useCaptureMatches(search, translation)
  return (
    <ul className={cn('flex flex-col divide-y rounded-xl border', className)}>
      {translation.candidates.map((candidate, index) => (
        <CaptureCandidateRow
          key={`${search.text}-${search.context}-${index}`}
          candidate={candidate}
          match={matches?.[index]}
          isMatching={isMatching}
          search={search}
          inputLanguage={translation.inputLanguage}
        />
      ))}
    </ul>
  )
}

// Each row owns its mutation so several adds run in parallel (mutate-level
// callbacks only fire for a hook's latest call). Add runs the regular ad-hoc
// card creation; once the card exists the row offers Edit instead.
const CaptureCandidateRow = ({
  candidate,
  match,
  isMatching,
  search,
  inputLanguage,
}: {
  candidate: CaptureCandidate
  match: CaptureMatch | undefined
  isMatching: boolean
  search: CaptureSearch
  inputLanguage: string | null
}) => {
  const { t } = useLingui()
  const { mutate: createAdhoc, isPending } = useCreateAdhocCard()
  // Added from this screen: labeled "Added", and pointing at the new card even
  // if the refreshed match doesn't resolve to it.
  const [addedCard, setAddedCard] = useState<CaptureCard | null>(null)
  const card = addedCard ?? match?.existingCard ?? null

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
        onSuccess: (response) => setAddedCard({ cardId: response.data.cardId, sessionId: response.data.sessionId }),
        onError: () => toast.error(t`Failed to create card`),
      }
    )
  }

  const rowText = { headword: candidate.headword, note: candidate.note, example: candidate.example }

  // Until the first match answer, neither Add nor Edit is known to be right.
  if (isMatching && !addedCard) {
    return (
      <TermRow {...rowText} status={<Skeleton className='h-4 w-24' />} actions={<Skeleton className='h-8 w-16' />} />
    )
  }

  if (card) {
    return (
      <TermRow
        {...rowText}
        status={<TermRowStatus tone='added'>{addedCard ? t`Added` : t`In your vocabulary`}</TermRowStatus>}
        actions={<EditCardButton card={card} />}
      />
    )
  }

  // Same headword saved with another meaning: say so, since Add is still
  // offered for this one.
  const savedSenses = (match?.otherSenses ?? []).map((sense) => `"${sense}"`).join(', ')
  return (
    <TermRow
      {...rowText}
      status={savedSenses && <TermRowStatus tone='muted'>{t`You have it as ${savedSenses}`}</TermRowStatus>}
      actions={
        <Button variant='secondary' size='sm' onClick={handleAdd} disabled={isPending}>
          {isPending ? <Loader2 className='size-4 animate-spin' /> : <Plus className='size-4' />}
          {t`Add`}
        </Button>
      }
    />
  )
}

// Icon-only on phones, labeled from sm up.
const EditCardButton = ({ card }: { card: CaptureCard }) => {
  const { t } = useLingui()
  return (
    <Button variant='outline' size='sm' asChild>
      <Link
        to='/sessions/$sessionId/review/$cardId'
        params={{ sessionId: card.sessionId, cardId: card.cardId }}
        search={{ scope: 'language' as const }}
        aria-label={t`Edit card`}
      >
        <Pencil className='size-3.5' />
        <span className='hidden sm:inline'>{t`Edit card`}</span>
      </Link>
    </Button>
  )
}

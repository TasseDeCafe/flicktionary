import { useEffect, useRef, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { toast } from 'sonner'
import { Loader2, Plus } from 'lucide-react'
import type { CaptureCandidate, CaptureMatch } from '@flicktionary/api-client/orpc-contracts/vocab-chat-contract'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Button } from '@flicktionary/ui/components/button'
import { Skeleton } from '@flicktionary/ui/components/skeleton'
import { useCreateAdhocCard } from '@/features/vocabulary/api/adhoc-hooks'
import { useCaptureMatches, useRecordCaptureDemand, type CaptureSearch } from '../api/vocab-chat-hooks'
import { useTestedBecause } from '../utils/use-tested-because'
import { CaptureMatchRow } from './capture-match-row'
import { EditCardButton } from './edit-card-button'
import { OtherSensesStatus, TermRow, TermRowStatus } from './term-row'

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
  const { data: matches, isLoading: isMatching } = useCaptureMatches({
    targetLanguage: search.targetLanguage,
    context: { kind: 'search', text: search.text, inputLanguage: translation.inputLanguage },
    candidates: translation.candidates.map(({ headword, note, example }) => ({ headword, note, example })),
  })
  useAutomaticCaptureDemand(search, translation.candidates, matches)
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

// Searching again for a saved word you never started is demand, like
// re-saving it: the result moves it up the new words, shown on its row with an
// Undo. Only the result the search was really for counts — the top one, or
// one spelled exactly like a target-language query — not related suggestions.
// Fired once per row per mount; the server also skips a term that had a
// capture event in the last hour, so remounts and refetches don't refire.
const useAutomaticCaptureDemand = (
  search: CaptureSearch,
  candidates: CaptureCandidate[],
  matches: CaptureMatch[] | undefined
) => {
  const { mutate: recordDemand } = useRecordCaptureDemand()
  const fired = useRef(new Set<string>())
  useEffect(() => {
    /* eslint-disable react-you-might-not-need-an-effect/no-event-handler, react-you-might-not-need-an-effect/no-pass-data-to-parent -- the trigger is the match QUERY resolving (async server data), not a user event: the learner never taps anything for the top result */
    if (!matches) return
    const query = search.text.trim().toLowerCase()
    matches.forEach((match, index) => {
      const candidate = candidates[index]
      if (!candidate || !match.existingCard || !match.status?.notStarted || match.status.demand) return
      if (index !== 0 && candidate.headword.toLowerCase() !== query) return
      const key = `${search.targetLanguage}|${search.text}|${search.context}|${index}`
      if (fired.current.has(key)) return
      fired.current.add(key)
      recordDemand({ userLookupId: match.existingCard.userLookupId, source: 'search' })
    })
  }, [matches, candidates, search.targetLanguage, search.text, search.context, recordDemand])
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
  const testedBecause = useTestedBecause()
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

  if (!addedCard && match?.existingCard && match.status) {
    return (
      <CaptureMatchRow
        rowText={rowText}
        card={match.existingCard}
        status={match.status}
        testedSkill={match.testedSkill}
        testedBecause={testedBecause.search(match.testedSkill, {
          inputLanguage,
          targetLanguage: search.targetLanguage,
        })}
      />
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

  return (
    <TermRow
      {...rowText}
      status={<OtherSensesStatus senses={match?.otherSenses ?? []} />}
      actions={
        <Button variant='secondary' size='sm' onClick={handleAdd} disabled={isPending}>
          {isPending ? <Loader2 className='size-4 animate-spin' /> : <Plus className='size-4' />}
          {t`Add`}
        </Button>
      }
    />
  )
}

import { useLingui } from '@lingui/react/macro'
import { Loader2, Plus, RotateCcw } from 'lucide-react'
import type { CaptureMatch, VocabChatMessage } from '@flicktionary/api-client/orpc-contracts/vocab-chat-contract'
import { Button } from '@flicktionary/ui/components/button'
import { Skeleton } from '@flicktionary/ui/components/skeleton'
import { useAddProposedItems, useCaptureMatches, useRetryProposalItem } from '../api/vocab-chat-hooks'
import { useTestedBecause } from '../utils/use-tested-because'
import { CaptureMatchRow } from './capture-match-row'
import { EditCardButton } from './edit-card-button'
import { OtherSensesStatus, TermRow, TermRowStatus } from './term-row'

type ProposalItem = NonNullable<VocabChatMessage['proposal']>['items'][number]

// The model's propose_cards output, as the same rows as a "Translate & add"
// search: membership by meaning and each word's practice status come from
// captureMatches, asked fresh. An added item is matched to its own term. Each
// row tests the card the learner's message points at: recognition when it
// used the word, production otherwise. Unlike the search, nothing here moves
// a word up on its own (a topic list isn't a failed recall); opening a card
// and the row's buttons still count.
export const ChatProposalList = ({
  sessionId,
  messageId,
  items,
  targetLanguage,
  userMessage,
}: {
  sessionId: string
  messageId: string
  items: ProposalItem[]
  targetLanguage: string
  // The learner message this proposal answers.
  userMessage: string
}) => {
  const { data: matches, isLoading: isMatching } = useCaptureMatches(
    {
      targetLanguage,
      context: { kind: 'chat', userMessage },
      candidates: items.map((item) => ({
        headword: item.headword,
        note: item.note,
        example: item.example,
        ...(item.addedCard ? { userLookupId: item.addedCard.userLookupId } : {}),
      })),
    },
    // An item turning into its term changes the request; the rows keep
    // their last answer meanwhile instead of flashing skeletons.
    { keepPrevious: true }
  )
  return (
    <ul className='bg-card flex flex-col divide-y rounded-xl border'>
      {items.map((item, index) => (
        <ChatProposalRow
          key={`${index}-${item.headword}`}
          sessionId={sessionId}
          messageId={messageId}
          index={index}
          item={item}
          match={matches?.[index]}
          isMatching={isMatching}
          targetLanguage={targetLanguage}
        />
      ))}
    </ul>
  )
}

// Each row owns its mutations so several adds run in parallel. Chat Add is
// asynchronous: the card comes from background enrichment, so an added item
// shows "Adding…" until its job finishes (the thread polls), then its term's
// status, or a Retry when the job failed.
const ChatProposalRow = ({
  sessionId,
  messageId,
  index,
  item,
  match,
  isMatching,
  targetLanguage,
}: {
  sessionId: string
  messageId: string
  index: number
  item: ProposalItem
  match: CaptureMatch | undefined
  isMatching: boolean
  targetLanguage: string
}) => {
  const { t } = useLingui()
  const testedBecause = useTestedBecause()
  const { mutate: addItems, isPending: isAdding } = useAddProposedItems(sessionId)
  const { mutate: retry, isPending: isRetrying } = useRetryProposalItem(sessionId)
  const rowText = { headword: item.headword, note: item.note, example: item.example }

  if (item.addState === 'pending') {
    return (
      <TermRow
        {...rowText}
        status={
          <span className='text-muted-foreground flex items-center gap-1'>
            <Loader2 className='size-3.5 animate-spin' />
            {t`Adding…`}
          </span>
        }
        actions={null}
      />
    )
  }

  if (item.addState === 'failed' && item.highlightId) {
    const highlightId = item.highlightId
    return (
      <TermRow
        {...rowText}
        status={<TermRowStatus tone='muted'>{t`Couldn't add this word`}</TermRowStatus>}
        actions={
          <Button variant='secondary' size='sm' disabled={isRetrying} onClick={() => retry({ sessionId, highlightId })}>
            {isRetrying ? <Loader2 className='size-3.5 animate-spin' /> : <RotateCcw className='size-3.5' />}
            {t`Retry`}
          </Button>
        }
      />
    )
  }

  if (match?.existingCard && match.status) {
    return (
      <CaptureMatchRow
        rowText={rowText}
        card={match.existingCard}
        status={match.status}
        testedSkill={match.testedSkill}
        testedBecause={testedBecause.chat(match.testedSkill, { targetLanguage })}
        offerMoveUp
      />
    )
  }

  // Added, while the match catches up with it.
  if (item.addedCard) {
    return (
      <TermRow
        {...rowText}
        status={<TermRowStatus tone='added'>{t`Added`}</TermRowStatus>}
        actions={<EditCardButton card={item.addedCard} />}
      />
    )
  }

  if (isMatching) {
    return (
      <TermRow {...rowText} status={<Skeleton className='h-4 w-24' />} actions={<Skeleton className='h-8 w-16' />} />
    )
  }

  return (
    <TermRow
      {...rowText}
      status={<OtherSensesStatus senses={match?.otherSenses ?? []} />}
      actions={
        <Button
          variant='secondary'
          size='sm'
          disabled={isAdding}
          onClick={() => addItems({ sessionId, messageId, itemIndexes: [index] })}
        >
          {isAdding ? <Loader2 className='size-4 animate-spin' /> : <Plus className='size-4' />}
          {t`Add`}
        </Button>
      }
    />
  )
}

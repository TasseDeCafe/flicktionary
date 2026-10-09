import { useState, type ReactNode } from 'react'
import { useLingui } from '@lingui/react/macro'
import { ArrowUp, CalendarClock, Loader2, Plus, RotateCcw } from 'lucide-react'
import type { CaptureMatch, CaptureTermStatus } from '@flicktionary/api-client/orpc-contracts/vocab-chat-contract'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { Button } from '@flicktionary/ui/components/button'
import { POSTHOG_EVENTS } from '@/lib/analytics/posthog-events'
import { useSetFacetEnabled } from '@/features/vocabulary/api/vocabulary-hooks'
import {
  useBoostFacet,
  useRecordCaptureDemand,
  useUnboostFacet,
  useUndoCaptureDemand,
  type CaptureSearch,
} from '../api/vocab-chat-hooks'
import { deriveCaptureRowState, testedFacet, type TestedSkill } from '../utils/capture-row-state'
import { CaptureFacetList, CaptureInfoButton } from './capture-info-sheet'
import { EditCardButton } from './edit-card-button'
import { TermRow, TermRowStatus } from './term-row'

type ExistingCard = NonNullable<CaptureMatch['existingCard']>

// A candidate the learner already has. The status speaks about the one card
// this search tested and says what a tap will do; every change to practice
// (demand, a boost, an added or resumed card) shows on the row and can be
// undone from it (docs/READER-SPEC.md → Translate & add).
export const CaptureMatchRow = ({
  rowText,
  card,
  status,
  testedSkill,
  search,
  inputLanguage,
}: {
  rowText: { headword: string; note: string; example: string }
  card: ExistingCard
  status: CaptureTermStatus
  testedSkill: TestedSkill
  search: CaptureSearch
  inputLanguage: string | null
}) => {
  const { t, i18n } = useLingui()
  const { mutate: recordDemand, isPending: isRecordingDemand } = useRecordCaptureDemand()
  const { mutate: undoDemand, isPending: isUndoingDemand } = useUndoCaptureDemand()
  const { mutate: boost, isPending: isBoosting } = useBoostFacet()
  const { mutate: unboost, isPending: isUnboosting } = useUnboostFacet()
  const { mutate: setFacetEnabled, isPending: isTogglingFacet } = useSetFacetEnabled()
  // The tested card was added or resumed from this row: its undo (disable it
  // again) is offered while the row stays mounted.
  const [enabledVia, setEnabledVia] = useState<'added' | 'resumed' | null>(null)

  const userLookupId = card.userLookupId
  const state = deriveCaptureRowState(status, testedSkill)
  const tested = testedFacet(status, testedSkill)
  const isProduction = testedSkill === 'meaning_production'
  const searchLanguage = getLanguageName(inputLanguage ?? search.targetLanguage)
  const targetLanguage = getLanguageName(search.targetLanguage)
  const facetList = <CaptureFacetList facets={status.facets} testedSkill={testedSkill} />
  const info = (children: ReactNode) => <CaptureInfoButton headword={rowText.headword}>{children}</CaptureInfoButton>

  const dueLabel = (dueInDays: number | null) => {
    if (dueInDays === null) return t`Not started`
    if (dueInDays <= 0) return t`Due today`
    if (dueInDays === 1) return t`Due tomorrow`
    const dayCount = dueInDays
    return t`Due in ${dayCount} days`
  }
  const learningLabel = (dueInDays: number | null) => {
    if (dueInDays === null || dueInDays <= 0) return t`Learning · due today`
    if (dueInDays === 1) return t`Learning · due tomorrow`
    const dayCount = dueInDays
    return t`Learning · due in ${dayCount} days`
  }

  const enableTested = (via: 'added' | 'resumed') =>
    setFacetEnabled(
      { chunkId: userLookupId, skill: testedSkill, targetForm: '', enabled: true },
      { onSuccess: () => setEnabledVia(via) }
    )
  const undoEnable = () =>
    setFacetEnabled(
      { chunkId: userLookupId, skill: testedSkill, targetForm: '', enabled: false },
      { onSuccess: () => setEnabledVia(null) }
    )
  const handleBoost = () => {
    const daysPulledForward = (tested?.dueInDays ?? 1) - 1
    boost(
      { userLookupId, skill: testedSkill },
      {
        onSuccess: (response) => {
          if (response.data.boosted) {
            POSTHOG_EVENTS.captureReviewBoosted({ skill: testedSkill, days_pulled_forward: daysPulledForward })
          }
        },
      }
    )
  }
  // Opening a not-started term's card counts as demand too (once an hour,
  // like the search's own).
  const handleOpenCard = () => {
    if (status.notStarted) recordDemand({ userLookupId, source: 'edit_card' })
  }

  const undoLink = (onClick: () => void, disabled: boolean) => (
    <>
      <span className='text-muted-foreground'>·</span>
      <button
        type='button'
        onClick={onClick}
        disabled={disabled}
        className='shrink-0 font-medium underline underline-offset-2 disabled:opacity-50'
      >
        {t`Undo`}
      </button>
    </>
  )

  let statusNode: ReactNode
  let action: ReactNode = null

  if (enabledVia === 'added') {
    statusNode = (
      <>
        <TermRowStatus tone='added'>{isProduction ? t`Production added` : t`Recognition added`}</TermRowStatus>
        {info(
          <p>
            {isProduction
              ? t`A new production card, introduced with your next new words.`
              : t`A new recognition card, introduced with your next new words.`}
          </p>
        )}
        {undoLink(undoEnable, isTogglingFacet)}
      </>
    )
  } else {
    switch (state.kind) {
      case 'not_started':
        if (state.demand === 'moved_up') {
          statusNode = (
            <>
              <TermRowStatus tone='added'>{t`Moved up`}</TermRowStatus>
              {info(
                <>
                  <p>{t`You haven't started this word yet. Because you looked for it again, it moves up in your new words.`}</p>
                  {!state.undoable && (
                    <p className='text-muted-foreground'>{t`You've also looked it up since, so this stays.`}</p>
                  )}
                </>
              )}
              {state.undoable && undoLink(() => undoDemand({ userLookupId }), isUndoingDemand)}
            </>
          )
        } else {
          statusNode = <TermRowStatus tone='muted'>{t`Not started`}</TermRowStatus>
          if (state.demand === 'undone') {
            action = (
              <Button
                variant='secondary'
                size='sm'
                disabled={isRecordingDemand}
                onClick={() => recordDemand({ userLookupId, source: 'move_up' })}
              >
                <ArrowUp className='size-3.5' />
                {t`Move up`}
              </Button>
            )
          }
        }
        break

      case 'tested_missing':
        statusNode = (
          <>
            <TermRowStatus tone='muted'>{isProduction ? t`No production card` : t`No recognition card`}</TermRowStatus>
            {info(
              <>
                <p>
                  {isProduction
                    ? t`You searched in ${searchLanguage}, which means coming up with the ${targetLanguage} word, but you don't practice that for this word. A production card may help.`
                    : t`You searched in ${searchLanguage}, which means recognizing the word, but you don't practice that for this word. A recognition card may help.`}
                </p>
                {facetList}
              </>
            )}
          </>
        )
        action = (
          <Button variant='secondary' size='sm' disabled={isTogglingFacet} onClick={() => enableTested('added')}>
            {isTogglingFacet ? <Loader2 className='size-3.5 animate-spin' /> : <Plus className='size-3.5' />}
            {isProduction ? t`Add production` : t`Add recognition`}
          </Button>
        )
        break

      case 'tested_paused':
        statusNode = (
          <>
            <TermRowStatus tone='muted'>{isProduction ? t`Production paused` : t`Recognition paused`}</TermRowStatus>
            {info(
              <>
                <p>{t`You paused this card. Resuming picks up its old schedule, so it may be due right away.`}</p>
                {facetList}
              </>
            )}
          </>
        )
        action = (
          <Button variant='secondary' size='sm' disabled={isTogglingFacet} onClick={() => enableTested('resumed')}>
            {isTogglingFacet ? <Loader2 className='size-3.5 animate-spin' /> : <RotateCcw className='size-3.5' />}
            {isProduction ? t`Resume production` : t`Resume recognition`}
          </Button>
        )
        break

      case 'tested_not_started':
        statusNode = <TermRowStatus tone='muted'>{t`Not started`}</TermRowStatus>
        break

      case 'rehab':
        statusNode = <TermRowStatus tone='muted'>{t`In rehab`}</TermRowStatus>
        break

      case 'preparing':
        statusNode = <TermRowStatus tone='muted'>{t`Being prepared`}</TermRowStatus>
        break

      case 'boosted': {
        const prevDue = state.prevDue ? i18n.date(new Date(state.prevDue), { month: 'short', day: 'numeric' }) : null
        statusNode = (
          <>
            <TermRowStatus tone='added'>{t`Due tomorrow`}</TermRowStatus>
            {info(
              <>
                <p>
                  {isProduction
                    ? t`Your production card will be in tomorrow's practice, ahead of other reviews.`
                    : t`Your recognition card will be in tomorrow's practice, ahead of other reviews.`}
                  {prevDue && <> {t`It was due ${prevDue}.`}</>}
                </p>
                {facetList}
              </>
            )}
            {state.undoable && undoLink(() => unboost({ userLookupId, skill: testedSkill }), isUnboosting)}
          </>
        )
        break
      }

      case 'learning':
        statusNode = <TermRowStatus tone='muted'>{learningLabel(state.dueInDays)}</TermRowStatus>
        break

      case 'boostable':
        statusNode = (
          <>
            <TermRowStatus tone='muted'>{dueLabel(state.dueInDays)}</TermRowStatus>
            {info(
              <>
                <p>
                  {isProduction
                    ? t`You searched in ${searchLanguage}, so this is about coming up with the word: your production card. Review tomorrow brings it forward if you'd forgotten it.`
                    : t`You searched in ${searchLanguage}, so this is about recognizing the word: your recognition card. Review tomorrow brings it forward if you'd forgotten what it means.`}
                </p>
                {facetList}
              </>
            )}
          </>
        )
        action = (
          <Button variant='secondary' size='sm' disabled={isBoosting} onClick={handleBoost}>
            {isBoosting ? <Loader2 className='size-3.5 animate-spin' /> : <CalendarClock className='size-3.5' />}
            {t`Review tomorrow`}
          </Button>
        )
        break

      case 'due':
        statusNode = <TermRowStatus tone='muted'>{dueLabel(state.dueInDays)}</TermRowStatus>
        break
    }
    // A resumed card shows its resumed schedule, with the way back.
    if (enabledVia === 'resumed') {
      statusNode = (
        <>
          {statusNode}
          {undoLink(undoEnable, isTogglingFacet)}
        </>
      )
    }
  }

  return (
    <TermRow
      {...rowText}
      status={statusNode}
      actions={
        <>
          {action}
          <EditCardButton card={card} onOpen={handleOpenCard} />
        </>
      }
    />
  )
}

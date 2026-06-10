import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Button } from '@flicktionary/ui/components/button'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { ChevronLeft, ChevronRight, ExternalLink, Sparkles, Trash2, X } from 'lucide-react'
import { pickIpa } from '@flicktionary/core/utils/pick-ipa'
import { buildWiktionaryUrl } from '@flicktionary/core/utils/wiktionary-url'
import { useExploreCard, useGetCard, useListCardsBySession, useUpdateCardStatus } from '../api/review-hooks'
import { invalidateCardEverywhere } from '../api/card-cache'
import { useDeleteChunk, useStudyTargets } from '@/features/vocabulary/api/vocabulary-hooks'
import { FormSelector } from './form-selector'
import { PerFormCardEditor } from './per-form-card-editor'
import type { FormAutoSetup, SelectedTarget } from './study-target-helpers'
import {
  ResponsiveOverlay,
  OverlayContent,
  OverlayDescription,
  OverlayFooter,
  OverlayHeader,
  OverlayTitle,
} from '@/components/ui/responsive-overlay'
import { useGetProcessingStatus, useGetStudySession, useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import { FullExplorationRenderer } from './full-exploration-renderer'
import { GrammarChips } from './grammar-chips'
import { ChatHeaderButton } from './chat-header-button'
import { ChatPanel, ChatSidePanel, useChatReadSync } from './chat-panel'
import { useIsMobile } from '@flicktionary/ui/hooks/use-is-mobile'
import { buildKeptCardCursor } from '../hooks/use-card-list-cursor'
import { useFocusKeyboardNav } from '../hooks/focus-keyboard-nav'
import { getShowTranslationsEnabledForLanguage } from '@/features/sessions/utils/show-translations-pref'

export const FocusView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { sessionId, cardId } = useParams({ from: '/_authenticated/_app/sessions/$sessionId/review/$cardId' })
  const { from, source, practiceLang, practicePool, practiceMode } = useSearch({
    from: '/_authenticated/_app/sessions/$sessionId/review/$cardId',
  })
  const fromVocabulary = from === 'vocabulary'
  const fromPractice = from === 'practice'
  // Practice & Vocabulary entries are language-wide views over kept chunks,
  // not session-scoped triage queues — same loading shortcut applies.
  const shouldLoadSessionScope = (!fromVocabulary && !fromPractice) || source === 'available'

  const { data: cards, dataUpdatedAt: cardsUpdatedAt } = useListCardsBySession(sessionId, {
    enabled: shouldLoadSessionScope,
  })
  const initialCard = useMemo(() => cards?.find((listCard) => listCard.id === cardId), [cards, cardId])
  const { data: card, isLoading } = useGetCard(cardId, initialCard, cardsUpdatedAt)
  // Study facets for the unified editor's selector + per-target editor. Lazily
  // fetched once the card (hence its chunk id) is known; shared by both controls.
  const { data: studyTargets } = useStudyTargets(card?.chunk.id ?? null)
  const facets = studyTargets?.facets ?? []
  const candidateForms = studyTargets?.candidateForms ?? []
  // Which study target the editor is focused on (reset to citation per card).
  const [selectedTarget, setSelectedTarget] = useState<SelectedTarget>({ kind: 'citation' })
  // One-shot: a form added via the "Add a form" sheet + the fill action to run in
  // the inline editor (so loading shows on the main view). Consumed once run.
  const [autoSetup, setAutoSetup] = useState<FormAutoSetup | null>(null)
  const handleSetupForm = (targetForm: string, action: FormAutoSetup['action']) => {
    setSelectedTarget({ kind: 'form', targetForm })
    setAutoSetup({ targetForm, action })
  }
  const { data: session } = useGetStudySession(sessionId, { enabled: shouldLoadSessionScope })
  // Vocabulary entries (including adhoc) intentionally skip the session
  // fetch, so we read the native language from user prefs to keep
  // sameLanguage detection working without a session row. When the session
  // IS loaded, we still prefer it (it carries the snapshotted native
  // language at session creation time, which matches what the LLM saw).
  const { data: userPrefs } = useGetUserPrefs()
  const { mutate: updateStatus } = useUpdateCardStatus(sessionId)
  const { mutate: deleteChunk, isPending: isDeletingChunk } = useDeleteChunk()
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const { mutate: exploreCard, isPending: isExploringAny, variables: exploringVariables } = useExploreCard()
  const isExploring = isExploringAny && exploringVariables?.cardId === cardId

  const cursor = useMemo(() => buildKeptCardCursor(cards ?? [], cardId), [cards, cardId])

  // Preserve the `from` origin across prev/next so the close button still
  // knows where to land after the user navigates around. Practice carries the
  // language + pool so the back-route resolves to the sessionless review screen.
  const search = from
    ? fromPractice && practiceLang
      ? { from, practiceLang, practicePool, practiceMode }
      : { from }
    : undefined
  const backToPractice = () => {
    if (!practiceLang) return
    void navigate({
      to: '/practice/review/$targetLanguage',
      params: { targetLanguage: practiceLang },
      // Scope is always 'mixed' on return: a flashcard queue re-seeds from a
      // fresh fetch anyway, and re-entering learn_new with its batch count
      // would serve a whole new batch of unseen terms.
      search: { pool: practicePool ?? 'passive', scope: 'mixed', mode: practiceMode ?? 'read' },
    })
  }
  const goPrev = () => {
    if (cursor.prev) {
      void navigate({
        to: '/sessions/$sessionId/review/$cardId',
        params: { sessionId, cardId: cursor.prev.id },
        search,
      })
    }
  }
  const goNext = () => {
    if (cursor.next) {
      void navigate({
        to: '/sessions/$sessionId/review/$cardId',
        params: { sessionId, cardId: cursor.next.id },
        search,
      })
    }
  }
  const [chatOpen, setChatOpen] = useState(false)
  const isMobile = useIsMobile()
  // On mobile the chat is a full-screen sheet, so prev/next keys are inert
  // while it's open. On desktop it's a side panel beside the card, so keep
  // keyboard nav live — you can page through cards with the panel open.
  useFocusKeyboardNav({ onPrev: goPrev, onNext: goNext, enabled: !(chatOpen && isMobile) })

  // Session scope for this view — undefined for language-wide (vocabulary/
  // practice) entries. Hoisted above the early returns so the seed-watch effect
  // and processing-status poll can read it without violating hook order.
  const sourceSessionId = shouldLoadSessionScope ? card?.studySessionId : undefined

  // Persist read state on open / when fresh assistant turns arrive while open.
  // Lives here (single owner) so the mobile sheet and desktop panel don't both fire.
  useChatReadSync({ open: chatOpen, cardId, sessionId: sourceSessionId })

  // Poll the session's processing status (only while something is in flight) to
  // light the chat dot: amber while a seeded answer for this card's highlight
  // generates, red when it failed. `hasUnreadChat` (server-derived) turns the
  // dot green once an unread answer is ready.
  const { data: processingStatus } = useGetProcessingStatus(sourceSessionId ?? '', 2000)
  const seedHighlightId = card?.highlightId ?? null
  const isChatGenerating =
    !!seedHighlightId && (processingStatus?.seedChatHighlightIds.includes(seedHighlightId) ?? false)
  const isChatFailed =
    !!seedHighlightId && (processingStatus?.failedSeedChatHighlightIds.includes(seedHighlightId) ?? false)

  // Live green transition while the panel is closed: when the seed job clears
  // (generating → gone), refetch the card so `hasUnreadChat` flips and the dot
  // turns green without a manual reload. Mirrors per-card-chat's seed watch.
  const queryClient = useQueryClient()
  const wasChatGeneratingRef = useRef(false)
  useEffect(() => {
    if (wasChatGeneratingRef.current && !isChatGenerating && sourceSessionId && card) {
      invalidateCardEverywhere(queryClient, { sessionId: sourceSessionId, cardId: card.id })
    }
    wasChatGeneratingRef.current = isChatGenerating
  }, [isChatGenerating, sourceSessionId, card, queryClient])

  // Brief "pressed" highlight before auto-advance: optimistic cache updates only
  // flip `status`, not `learning_mode`, so we can't rely on derived state alone
  // for the visual confirmation. Reset on cardId change so the next card mounts
  // with a clean slate. Declared above the early returns to keep hook order
  // stable across loading/empty states.
  const [pendingAction, setPendingAction] = useState<'reject' | 'keep' | null>(null)
  useEffect(() => {
    setPendingAction(null)
    setSelectedTarget({ kind: 'citation' })
    setAutoSetup(null)
  }, [cardId])

  const closeToTriage = () => {
    if (from === 'vocabulary') {
      void navigate({ to: '/vocabulary' })
      return
    }
    if (from === 'practice' && practiceLang) {
      backToPractice()
      return
    }
    void navigate({ to: '/sessions/$sessionId/review', params: { sessionId } })
  }

  if (isLoading) {
    return (
      <ModalScreen onClose={closeToTriage} closeIcon='chevron' title={t`Card`}>
        <div className='text-muted-foreground mx-auto max-w-4xl px-4 py-6 text-sm'>{t`Loading card…`}</div>
      </ModalScreen>
    )
  }
  if (!card) {
    return (
      <ModalScreen onClose={closeToTriage} closeIcon='chevron' title={t`Card`}>
        <div className='text-muted-foreground mx-auto max-w-4xl px-4 py-6 text-sm'>{t`Card not found.`}</div>
      </ModalScreen>
    )
  }

  const hasExtras = Object.keys(card.chunk.explorationExtras ?? {}).length > 0
  const hasBasicData = !!(
    (card.chunk.translation && card.chunk.translation.trim().length > 0) ||
    (card.chunk.definition && card.chunk.definition.trim().length > 0) ||
    (card.chunk.targetExample && card.chunk.targetExample.trim().length > 0)
  )
  const targetLanguage = session?.targetLanguage ?? card.chunk.targetLanguage
  // Live user pref wins over the session snapshot — if the user changed their
  // L1 after creating the session, what they expect now is the live value.
  const nativeLanguage = userPrefs?.nativeLanguage ?? session?.nativeLanguage ?? null
  // Wiktionary-grounded IPA. When set, the full-exploration renderer must
  // suppress its own `extras.ipa` so we don't show pronunciation twice.
  const displayedIpa = pickIpa(card.chunk.grammar?.ipa, targetLanguage, userPrefs?.englishIpaDialect ?? 'ga')
  const wiktionaryUrl = buildWiktionaryUrl(card.chunk.headword, targetLanguage, card.chunk.grammar?.pos)
  const sameLanguage = !!nativeLanguage && nativeLanguage.trim().toLowerCase() === targetLanguage.trim().toLowerCase()
  // sameLanguage: translation fields are meaningless — fully hidden. With the
  // translations pref off they're not auto-generated but can be added manually
  // behind a disclosure. Display of stored values is presence-based everywhere.
  const translationFieldsMode = sameLanguage
    ? ('hidden' as const)
    : getShowTranslationsEnabledForLanguage(userPrefs, targetLanguage)
      ? ('editable' as const)
      : ('on-demand' as const)
  const showL1Notes = !!nativeLanguage && !sameLanguage
  const cardPosition = cursor.index + 1
  const cardTotal = cursor.total
  const positionLabel = cursor.index >= 0 ? t`Card ${cardPosition} of ${cardTotal}` : t`Standalone`
  // Vocabulary + Practice entries are already kept by definition, so the
  // keep/reject toggles and the per-session position counter don't apply.
  // Show the chunk's headword as the title instead.
  const isLanguageWideEntry = fromVocabulary || fromPractice
  const deleteHeadword = card.chunk.headword
  const title = isLanguageWideEntry ? card.chunk.headword : positionLabel

  // Prev/next pager lives in the header (right side, away from the back
  // chevron) so it never overlaps the scrolling card content. Only triage
  // cards have a position to page through; vocabulary/practice entries don't.
  // The chat button is always present — chat exists for all card types.
  const headerNav = (
    <>
      {!isLanguageWideEntry && (
        <>
          <Button variant='ghost' size='icon' onClick={goPrev} disabled={!cursor.prev} aria-label={t`Previous card`}>
            <ChevronLeft className='size-6 md:size-5' />
          </Button>
          <Button variant='ghost' size='icon' onClick={goNext} disabled={!cursor.next} aria-label={t`Next card`}>
            <ChevronRight className='size-6 md:size-5' />
          </Button>
        </>
      )}
      <ChatHeaderButton
        hasUnread={card.hasUnreadChat}
        isGenerating={isChatGenerating}
        isFailed={isChatFailed}
        onClick={() => setChatOpen((o) => !o)}
      />
    </>
  )

  // Advance to the next card on a triage decision; if we're on the last card,
  // bounce back to the triage list so the user isn't stranded.
  const advanceOrClose = () => {
    if (cursor.next) goNext()
    else closeToTriage()
  }

  const triggerAction = (action: 'reject' | 'keep') => {
    if (pendingAction) return
    setPendingAction(action)
    if (action === 'reject') {
      if (card.status !== 'rejected') updateStatus({ cardId: card.id, status: 'rejected' })
    } else {
      // Keep just enables recognition server-side; the passive/active fork is
      // gone (production is now a per-target study facet edited elsewhere).
      if (card.status !== 'kept') updateStatus({ cardId: card.id, status: 'kept' })
    }
    setTimeout(() => advanceOrClose(), 220)
  }

  const desktopChatOpen = chatOpen && isMobile === false

  return (
    <div className='flex h-dvh'>
      <div className='flex min-w-0 flex-1 flex-col'>
        <ModalScreen onClose={closeToTriage} closeIcon='chevron' title={title} rightSlot={headerNav}>
          <div className='flex-1 overflow-y-auto px-4 py-4'>
            <div className='mx-auto flex max-w-4xl flex-col gap-6'>
              <section>
                <h2 className='text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase'>{t`Card`}</h2>
                <div className='mb-3 flex flex-wrap items-center gap-2'>
                  <GrammarChips grammar={card.chunk.grammar} targetLanguage={targetLanguage} />
                  {wiktionaryUrl && (
                    <a
                      href={wiktionaryUrl}
                      target='_blank'
                      rel='noreferrer'
                      className='text-foreground hover:bg-accent inline-flex items-center gap-1 rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors'
                    >
                      <ExternalLink className='h-3 w-3' />
                      {t`Wiktionary`}
                    </a>
                  )}
                </div>
                {/* Study-target selector (Citation + forms + Add a form) drives
                    the editor below. Shown in triage too — keeping a card on
                    Keep just enables recognition; this lets the learner set up
                    forms/skills + edit content before/after that decision. */}
                <FormSelector
                  chunk={card.chunk}
                  facets={facets}
                  candidateForms={candidateForms}
                  selectedTarget={selectedTarget}
                  onSelect={setSelectedTarget}
                  onSetupForm={handleSetupForm}
                />
                <div className='mt-4'>
                  <PerFormCardEditor
                    chunk={card.chunk}
                    cardUpdatedAt={card.updatedAt}
                    selectedTarget={selectedTarget}
                    facets={facets}
                    translationFieldsMode={translationFieldsMode}
                    sourceSessionId={sourceSessionId}
                    fromVocabulary={fromVocabulary}
                    autoSetup={autoSetup}
                    onAutoSetupConsumed={() => setAutoSetup(null)}
                  />
                </div>
              </section>

              <section>
                {/* Language-wide entries are already-kept terms: offer a
                    secondary delete affordance (triage cards delete via the
                    Reject bar, so this is gated to kept entries). */}
                {isLanguageWideEntry && (
                  <div className='mb-6'>
                    <Button
                      variant='ghost'
                      size='sm'
                      className='text-destructive hover:text-destructive hover:bg-destructive/10'
                      onClick={() => setDeleteConfirmOpen(true)}
                    >
                      <Trash2 className='mr-1 h-4 w-4' />
                      {t`Delete term`}
                    </Button>
                  </div>
                )}
                <h2 className='text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase'>{t`Full exploration`}</h2>
                {hasExtras ? (
                  <FullExplorationRenderer card={card} hideExtrasIpa={!!displayedIpa} showL1Notes={showL1Notes} />
                ) : (
                  <div className='flex flex-col items-start gap-3'>
                    <p className='text-muted-foreground text-sm'>
                      {isExploring
                        ? t`Generating full exploration… this takes a few seconds.`
                        : hasBasicData
                          ? t`Click Generate full exploration to enrich this card with collocations, etymology, register, IPA, and more.`
                          : t`This card looks incomplete. Re-process the session to populate its basic data, then come back to enrich it.`}
                    </p>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => exploreCard({ cardId: card.id })}
                      disabled={isExploring}
                    >
                      <Sparkles className='mr-1 h-4 w-4' />
                      {isExploring ? t`Generating…` : t`Generate full exploration`}
                    </Button>
                  </div>
                )}
              </section>
            </div>
          </div>

          {/* Language-wide entries (vocabulary AND practice origins) are
              already kept — their study targets + delete affordance live inline
              in the scrollable content above, so there's no bottom action bar. */}
          {!isLanguageWideEntry && (
            <FocusActionBar
              card={card}
              pendingAction={pendingAction}
              onReject={() => triggerAction('reject')}
              onKeep={() => triggerAction('keep')}
            />
          )}

          {isLanguageWideEntry && (
            <ResponsiveOverlay open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
              <OverlayContent>
                <OverlayHeader>
                  <OverlayTitle>{t`Delete "${deleteHeadword}"?`}</OverlayTitle>
                  <OverlayDescription>
                    {t`Hides this term from your vocabulary and Practice. You can revive it by re-keeping it in a session.`}
                  </OverlayDescription>
                </OverlayHeader>
                <OverlayFooter>
                  <Button
                    type='button'
                    variant='outline'
                    size='xl'
                    disabled={isDeletingChunk}
                    onClick={() => setDeleteConfirmOpen(false)}
                  >
                    {t`Cancel`}
                  </Button>
                  <Button
                    type='button'
                    variant='destructive'
                    size='xl'
                    disabled={isDeletingChunk}
                    onClick={() => {
                      deleteChunk(
                        { id: card.chunk.id },
                        {
                          onSuccess: () => {
                            setDeleteConfirmOpen(false)
                            closeToTriage()
                          },
                        }
                      )
                    }}
                  >
                    {isDeletingChunk ? t`Deleting…` : t`Delete`}
                  </Button>
                </OverlayFooter>
              </OverlayContent>
            </ResponsiveOverlay>
          )}

          {/* Mobile: full-screen sheet overlay (fixed-positioned, so it can
              live inside the card column). */}
          {isMobile && (
            <ChatPanel
              open={chatOpen}
              onOpenChange={setChatOpen}
              cardId={card.id}
              sessionId={sourceSessionId}
              highlightId={card.highlightId}
            />
          )}
        </ModalScreen>
      </div>

      {/* Desktop: real side panel beside the card column — reflows the layout
          instead of overlaying, so the card stays readable + navigable. */}
      {desktopChatOpen && (
        <ChatSidePanel
          onClose={() => setChatOpen(false)}
          cardId={card.id}
          sessionId={sourceSessionId}
          highlightId={card.highlightId}
        />
      )}
    </div>
  )
}

type FocusActionBarProps = {
  card: {
    status: 'pending' | 'kept' | 'rejected' | 'auto_rejected'
  }
  // When set, overrides the state-derived highlight so the just-tapped button
  // stays filled during the brief delay before navigation.
  pendingAction: 'reject' | 'keep' | null
  onReject: () => void
  onKeep: () => void
}

const FocusActionBar = ({ card, pendingAction, onReject, onKeep }: FocusActionBarProps) => {
  const { t } = useLingui()
  const isRejected = pendingAction
    ? pendingAction === 'reject'
    : card.status === 'rejected' || card.status === 'auto_rejected'
  const isKept = pendingAction ? pendingAction === 'keep' : card.status === 'kept'

  return (
    <div className='bg-background shrink-0 border-t px-4 py-3'>
      <div className='mx-auto flex w-full max-w-4xl items-stretch gap-2'>
        <Button size='xl' variant={isRejected ? 'destructive' : 'outline'} className='flex-1' onClick={onReject}>
          <X className='mr-1 h-4 w-4' />
          {t`Reject`}
        </Button>
        <Button size='xl' variant={isKept ? 'default' : 'outline'} className='flex-1' onClick={onKeep}>
          {t`Keep`}
        </Button>
      </div>
    </div>
  )
}

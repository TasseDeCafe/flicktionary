import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Button } from '@flicktionary/ui/components/button'
import { Skeleton } from '@flicktionary/ui/components/skeleton'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { ChevronLeft, ChevronRight, ExternalLink, Sparkles, Trash2 } from 'lucide-react'
import { pickIpa } from '@flicktionary/core/utils/pick-ipa'
import { composeGermanCitation } from '@flicktionary/core/utils/german-noun-forms'
import { buildWiktionaryUrl } from '@flicktionary/core/utils/wiktionary-url'
import { useExploreCard, useGetCard, useListCardsBySession, useRemoveCardFromSession } from '../api/review-hooks'
import { invalidateCardEverywhere } from '../api/card-cache'
import { useDeleteChunk, useStudyTargets } from '@/features/vocabulary/api/vocabulary-hooks'
import { getStudyTargetsKey } from '@/features/vocabulary/api/facet-cache'
import { getSavedVocabularySearch } from '@/features/vocabulary/saved-search'
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
  // not session-scoped vocabulary lists — same loading shortcut applies.
  const shouldLoadSessionScope = (!fromVocabulary && !fromPractice) || source === 'available'

  const { data: cards, dataUpdatedAt: cardsUpdatedAt } = useListCardsBySession(sessionId, {
    enabled: shouldLoadSessionScope,
  })
  const initialCard = useMemo(() => cards?.find((listCard) => listCard.id === cardId), [cards, cardId])
  const { data: card, isLoading } = useGetCard(cardId, initialCard, cardsUpdatedAt)

  // Session scope for this view — undefined for language-wide (vocabulary/
  // practice) entries. Hoisted above the early returns so the seed-watch effect
  // and processing-status poll can read it without violating hook order.
  const sourceSessionId = shouldLoadSessionScope ? card?.studySessionId : undefined

  // Poll the session's processing status (only while something is in flight).
  // Feeds the chat dot below AND the study-targets refresh: while this card's
  // highlight is being enriched server-side, the background job is also filling
  // any pending form facet created by a study-intent save.
  const { data: processingStatus } = useGetProcessingStatus(sourceSessionId ?? '', 2000)
  const isFormDataEnriching =
    !!card?.highlightId && (processingStatus?.enrichingHighlightIds.includes(card.highlightId) ?? false)

  // Entry paths without an observable session (vocabulary/practice) can't see
  // enrichingHighlightIds, so give the study-targets poll a ~20s grace window
  // after mount/card change to catch a just-saved card's background fill.
  const [withinMountGrace, setWithinMountGrace] = useState(true)
  useEffect(() => {
    setWithinMountGrace(true)
    const timer = setTimeout(() => setWithinMountGrace(false), 20_000)
    return () => clearTimeout(timer)
  }, [cardId])

  // Study facets for the unified editor's selector + per-target editor. Lazily
  // fetched once the card (hence its chunk id) is known; shared by both controls.
  // Polls while a background fill may land (the hook self-stops once no facet
  // is pending_data, so deliberately-pending "enter manually" facets only cost
  // the grace window).
  const { data: studyTargets } = useStudyTargets(card?.chunk.id ?? null, {
    refetchInterval: isFormDataEnriching || withinMountGrace ? 2000 : false,
  })
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
  const { mutate: removeFromSession } = useRemoveCardFromSession(sessionId)
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
    // Flashcards live in the composed queue now; close lands on a fresh
    // everyday compose (the queue re-seeds from a fresh fetch anyway). A
    // reading-mode origin returns to the reading route, scope reset to
    // 'mixed'.
    if (practiceMode === 'flashcards') {
      void navigate({
        to: '/practice/composed/$targetLanguage',
        params: { targetLanguage: practiceLang },
        search: {
          pools: ['production', 'recognition'],
          scope: 'both',
          render: 'both',
          autoWarmup: true,
          includeOptInNew: false,
        },
      })
      return
    }
    void navigate({
      to: '/practice/review/$targetLanguage',
      params: { targetLanguage: practiceLang },
      search: { pool: practicePool ?? 'recognition', scope: 'mixed' },
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

  // Persist read state on open / when fresh assistant turns arrive while open.
  // Lives here (single owner) so the mobile sheet and desktop panel don't both fire.
  useChatReadSync({ open: chatOpen, cardId, sessionId: sourceSessionId })

  // Chat dot: amber while a seeded answer for this card's highlight generates,
  // red when it failed. `hasUnreadChat` (server-derived) turns the dot green
  // once an unread answer is ready.
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

  // When this card's background enrichment finishes (enriching → gone), refetch
  // the study targets so a study-intent form facet's generated data appears
  // without a reload, and the card itself — enrichment also writes chunk fields.
  // Explicit keys: there is no client mutation to hang meta.invalidates on.
  const wasFormDataEnrichingRef = useRef(false)
  useEffect(() => {
    if (wasFormDataEnrichingRef.current && !isFormDataEnriching && sourceSessionId && card) {
      void queryClient.invalidateQueries({ queryKey: getStudyTargetsKey(card.chunk.id) })
      invalidateCardEverywhere(queryClient, { sessionId: sourceSessionId, cardId: card.id })
    }
    wasFormDataEnrichingRef.current = isFormDataEnriching
  }, [isFormDataEnriching, sourceSessionId, card, queryClient])

  // Reset the per-card editor selection on cardId change so the next card mounts
  // with a clean slate. Declared above the early returns to keep hook order
  // stable across loading/empty states.
  useEffect(() => {
    setSelectedTarget({ kind: 'citation' })
    setAutoSetup(null)
  }, [cardId])

  const closeToSessionVocabulary = () => {
    if (from === 'vocabulary') {
      // Restore the sort/filter state the user was browsing under (the close
      // nav would otherwise rebuild /vocabulary with an empty search).
      void navigate({ to: '/vocabulary', search: getSavedVocabularySearch() })
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
      <ModalScreen onClose={closeToSessionVocabulary} closeIcon='chevron' title={t`Card`}>
        <FocusViewSkeleton />
      </ModalScreen>
    )
  }
  if (!card) {
    return (
      <ModalScreen onClose={closeToSessionVocabulary} closeIcon='chevron' title={t`Card`}>
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
  // A kept term must keep ≥1 enabled skill per target (backend floor guard); the
  // SkillsCard last-skill lock is the friendly front. Language-wide entries are
  // kept by definition; session entries auto-keep once they have basic data, so
  // a data-bearing session card reads as kept here too.
  const isKeptTerm = isLanguageWideEntry || card.status === 'kept'
  const deleteHeadword = card.chunk.headword
  // German citation nouns show the derived article title (`der Bestandteil`); the
  // helper falls back to display_form || headword for every other language.
  const headwordTitle = composeGermanCitation({
    headword: card.chunk.headword,
    grammar: card.chunk.grammar,
    targetLanguage,
  }).title
  const title = isLanguageWideEntry ? headwordTitle : positionLabel

  // Prev/next pager lives in the header (right side, away from the back
  // chevron) so it never overlaps the scrolling card content. Only session
  // entries have a position to page through; vocabulary/practice entries don't
  // load the session card list, so they have no cursor.
  // The chat button is always present — chat exists for all card types.
  const hasSessionCursor = cursor.index >= 0
  const headerNav = (
    <>
      {hasSessionCursor && (
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

  // Advance to the next card after a remove; if we're on the last card, bounce
  // back to the session-vocabulary list so the user isn't stranded.
  const advanceOrClose = () => {
    if (cursor.next) goNext()
    else closeToSessionVocabulary()
  }

  // Remove-from-session = unkeep this card (non-destructive). It survives in
  // Vocabulary if kept elsewhere; the count badge decrements; the last keep
  // takes count to 0 and it leaves Vocabulary naturally. No deleted_at, no
  // cross-session nuking, no warning — then advance to the next card.
  const handleRemoveFromSession = () => {
    if (card.status !== 'removed') removeFromSession({ cardId: card.id })
    advanceOrClose()
  }

  const desktopChatOpen = chatOpen && isMobile === false

  return (
    <div className='flex h-dvh'>
      <div className='flex min-w-0 flex-1 flex-col'>
        <ModalScreen onClose={closeToSessionVocabulary} closeIcon='chevron' title={title} rightSlot={headerNav}>
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
                    the editor below. Session entries are auto-kept once they
                    have data, so learners can set up forms/skills and edit
                    content directly from here. */}
                <FormSelector
                  chunk={card.chunk}
                  facets={facets}
                  candidateForms={candidateForms}
                  selectedTarget={selectedTarget}
                  isKept={isKeptTerm}
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
                {/* Scope-aware remove affordance. Language-wide entries
                    (vocabulary/practice) Delete the term everywhere (soft-delete,
                    behind a confirm). Session entries Remove-from-session, which
                    just unkeeps this card — non-destructive, no confirm. */}
                <div className='mb-6'>
                  {isLanguageWideEntry ? (
                    <Button
                      variant='ghost'
                      size='sm'
                      className='text-destructive hover:text-destructive hover:bg-destructive/10'
                      onClick={() => setDeleteConfirmOpen(true)}
                    >
                      <Trash2 className='mr-1 h-4 w-4' />
                      {t`Delete term`}
                    </Button>
                  ) : (
                    <Button
                      variant='ghost'
                      size='sm'
                      className='text-destructive hover:text-destructive hover:bg-destructive/10'
                      onClick={handleRemoveFromSession}
                    >
                      <Trash2 className='mr-1 h-4 w-4' />
                      {t`Remove from session`}
                    </Button>
                  )}
                </div>
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
                          : t`This is a note-only card with no flashcard data yet. Click Generate full exploration to fill its translation, definition, and examples — then you can keep it.`}
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

          {/* No bottom keep/reject bar: cards auto-keep once they have basic
              data, and removal lives inline in the scrollable content above
              (Remove from session / Delete term). */}
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
                            closeToSessionVocabulary()
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

// A labeled input/textarea placeholder, mirroring the editor's field layout.
const FieldSkeleton = ({ multiline = false }: { multiline?: boolean }) => (
  <div>
    <Skeleton className='h-3 w-24' />
    <Skeleton className={`mt-1.5 w-full rounded-md ${multiline ? 'h-20' : 'h-10'}`} />
  </div>
)

// Mirrors the focus view body: CARD chips, the study-target chip + Skills card,
// then the labeled content fields — so the layout doesn't jump when the card loads.
const FocusViewSkeleton = () => (
  <div className='flex-1 overflow-y-auto px-4 py-4'>
    <div className='mx-auto flex max-w-4xl flex-col gap-6'>
      <section>
        <Skeleton className='mb-3 h-3 w-12' />
        <div className='mb-3 flex flex-wrap items-center gap-2'>
          <Skeleton className='h-6 w-14 rounded-md' />
          <Skeleton className='h-6 w-24 rounded-md' />
        </div>

        <Skeleton className='mb-3 h-3 w-28' />
        <Skeleton className='h-9 w-24 rounded-full' />

        <div className='mt-4 rounded-xl border p-4'>
          <div className='flex items-start justify-between gap-2'>
            <div className='flex flex-col gap-2'>
              <Skeleton className='h-4 w-16' />
              <Skeleton className='h-6 w-28 rounded-md' />
            </div>
            <Skeleton className='h-8 w-8 shrink-0 rounded-full' />
          </div>
        </div>

        <div className='mt-4 flex flex-col gap-4'>
          <FieldSkeleton />
          <FieldSkeleton multiline />
          <FieldSkeleton />
          <FieldSkeleton multiline />
        </div>
      </section>
    </div>
  </div>
)

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import { ChevronDown, ChevronUp, PencilLine, Save, Trash2 } from 'lucide-react'
import { KAIKKI_LANGUAGES } from '@flicktionary/core/constants/language-grammar'
import { parseFastGloss } from '@flicktionary/core/utils/parse-fast-gloss'
import type { GlossViewState } from '@flicktionary/core/types/gloss-view-state'
import type { GhostCandidate } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { orpcQuery } from '@/lib/transport/orpc-client'
import { Button } from '@flicktionary/ui/components/button'
import { GlossCardBody } from '@flicktionary/ui/components/gloss-card-body'
import { composeChatSeedPrompt, usePresetTagTexts, type PresetTag } from '@flicktionary/ui/components/preset-tags'
import { HighlightNoteEditor } from '@flicktionary/ui/components/highlight-note-editor'
import {
  StudyOptionsSection,
  defaultStudyIntentDraft,
  draftToStudyIntent,
  type StudyIntentDraft,
} from '@flicktionary/ui/components/study-options-section'
import { EnglishIpaDialectFlag } from '@/components/english-ipa-dialect-flag'
import {
  FloatingSheet,
  FloatingSheetBody,
  FloatingSheetContent,
  FloatingSheetExpanded,
  FloatingSheetExpandToggle,
  FloatingSheetFooter,
  FloatingSheetHeader,
  FloatingSheetTitle,
  type FloatingSheetAnchor,
} from '@flicktionary/ui/components/floating-sheet'
import {
  isOptimisticHighlightId,
  useCreateHighlight,
  useDeleteHighlight,
  useFastGloss,
  useGetUserPrefs,
  useStatelessGloss,
  useSwitchGhost,
  useUpdateHighlightNoteAndTags,
} from '../api/sessions-hooks'
import type { SelectionResult } from '../utils/selection-adapter'

export type ExistingHighlightInput = {
  id: string
  selectionText: string
  note: string | null
  presetTags: string[]
  fastGloss: string | null
}

interface SessionGlossSheetProps {
  open: boolean
  sessionId: string
  targetLanguage: string
  // Provide exactly one when `open=true`. `selection` is a fresh mouseup/touchend
  // result (the sheet creates the highlight). `existingHighlight` is a click on
  // an already-saved highlight span (the sheet reads cached metadata).
  selection: SelectionResult | null
  existingHighlight: ExistingHighlightInput | null
  // Set (for a fresh selection only) when the selection overlaps a ghost candidate.
  // The sheet then offers to swap the just-created highlight for the LLM's span.
  // Already null whenever LLM suggestions are off (the parent gates it).
  suggestedGhost: GhostCandidate | null
  // Set when the current `selection` came from a pre-save ghost adoption; Save
  // forwards it as `adoptedGhostId` (the backend dismisses the ghost with the
  // insert). The open/selection reset keys off it to keep the skill checkboxes
  // across the swap while re-arming the exact-form toggle.
  pendingGhostId: string | null
  // Pre-save "Use suggested": swap the parent's LOCAL selection to the ghost's
  // span (no highlight exists yet — the saved-mode path uses ghosts.switch).
  onAdoptGhostPreSave: (ghost: GhostCandidate) => void
  anchor: FloatingSheetAnchor
  onClose: () => void
}

type CachedHighlight = {
  id: string
  selectionText: string
  startSegmentId: string
  endSegmentId: string
  startOffset: number
  endOffset: number
  fastGloss: string | null
  note: string | null
  presetTags: string[]
}

// Looks up a highlight row matching the given selection so a re-tap on the same
// span doesn't create a duplicate. Inlined from the old use-tap-to-translate
// hook — only used here now. Optimistic rows are skipped: a re-selection while
// the create is still in flight opens in preview mode instead of pointing the
// sheet's note/delete actions at a temp id the server doesn't know.
const findCachedHighlight = (
  cached: CachedHighlight[] | undefined,
  selection: SelectionResult
): CachedHighlight | null => {
  if (!cached) return null
  return (
    cached.find(
      (h) =>
        !isOptimisticHighlightId(h.id) &&
        h.startSegmentId === selection.startSegmentId &&
        h.endSegmentId === selection.endSegmentId &&
        h.startOffset === selection.startOffset &&
        h.endOffset === selection.endOffset &&
        h.selectionText === selection.selectionText
    ) ?? null
  )
}

export const SessionGlossSheet = ({
  open,
  sessionId,
  targetLanguage,
  selection,
  existingHighlight,
  suggestedGhost,
  pendingGhostId,
  onAdoptGhostPreSave,
  anchor,
  onClose,
}: SessionGlossSheetProps) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const { data: userPrefs } = useGetUserPrefs()

  const { mutateAsync: createHighlight } = useCreateHighlight(sessionId)
  const { mutateAsync: fetchGloss } = useFastGloss()
  const { mutateAsync: fetchStatelessGloss } = useStatelessGloss()
  const { mutate: deleteHighlight, isPending: isDeleting } = useDeleteHighlight(sessionId)
  const { mutate: saveNoteAndTags, isPending: isSavingNote } = useUpdateHighlightNoteAndTags(sessionId)
  const { mutateAsync: switchGhost, isPending: isSwitching } = useSwitchGhost(sessionId)

  const { prompts: presetPrompts } = usePresetTagTexts()

  const [glossState, setGlossState] = useState<GlossViewState>({ status: 'idle' })
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [titleText, setTitleText] = useState<string>('')
  const [note, setNote] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [expanded, setExpanded] = useState(false)
  // Set once a ghost has been adopted in this open session, to hide the action.
  const [adopted, setAdopted] = useState(false)
  // True while an explicit Save (preview → saved) is creating the highlight.
  const [isSaving, setIsSaving] = useState(false)
  // The "Study options" draft. Untouched → no studyIntent on Save (the backend
  // keep-time default applies); touched → the FULL SET of checked skills.
  const [studyDraft, setStudyDraft] = useState<StudyIntentDraft>(defaultStudyIntentDraft)

  useLayoutEffect(() => {
    if (!open) return
    setExpanded(false)
    setAdopted(false)
    setIsSaving(false)
    // Fresh open / new gesture selection → full reset. A pre-save ghost
    // adoption swaps the selection too (pendingGhostId set in the same render):
    // the skill choices are about the word, so they survive the swap, but the
    // exact-form toggle is re-armed — its referent (the surface) just changed.
    setStudyDraft((prev) => (pendingGhostId ? { ...prev, exactForm: false } : defaultStudyIntentDraft))

    if (existingHighlight) {
      setHighlightId(existingHighlight.id)
      setTitleText(existingHighlight.selectionText)
      setNote(existingHighlight.note ?? '')
      setTags(existingHighlight.presetTags)
      setGlossState(
        existingHighlight.fastGloss
          ? { status: 'ready', ...parseFastGloss(existingHighlight.fastGloss), ipaDisplay: null }
          : { status: 'loading' }
      )
      return
    }

    if (selection) {
      setHighlightId(null)
      setTitleText(selection.selectionText)
      setNote('')
      setTags([])
      setGlossState({ status: 'loading' })
    }
  }, [open, existingHighlight, selection, pendingGhostId])

  // Seed from the existing-highlight branch.
  useEffect(() => {
    if (!open || !existingHighlight) return
    setHighlightId(existingHighlight.id)
    setTitleText(existingHighlight.selectionText)
    setNote(existingHighlight.note ?? '')
    setTags(existingHighlight.presetTags)
    setExpanded(false)
    const cachedGloss = existingHighlight.fastGloss ? parseFastGloss(existingHighlight.fastGloss) : null
    if (cachedGloss) {
      setGlossState({ status: 'ready', ...cachedGloss, ipaDisplay: null })
    } else {
      setGlossState({ status: 'loading' })
    }
    // Fetch even when a cached gloss exists so old highlight rows can be
    // enriched with Wiktionary IPA without changing the fast_gloss column.
    let cancelled = false
    void (async () => {
      try {
        const res = await fetchGloss({ sessionId, highlightId: existingHighlight.id })
        if (cancelled) return
        setGlossState({
          status: 'ready',
          gloss: res.data.gloss,
          pos: res.data.pos,
          register: res.data.register,
          ipaDisplay: res.data.ipaDisplay,
        })
      } catch {
        if (!cancelled && !cachedGloss) setGlossState({ status: 'error', message: null })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, existingHighlight, sessionId, fetchGloss])

  // Seed from a fresh selection. Preview-first: looking is free and ephemeral.
  //  - If the selection matches an already-saved highlight → open in "saved"
  //    mode (its gloss/note/tags, Remove/Edit available).
  //  - Otherwise → open in "preview" mode: fetch a FREE stateless gloss and
  //    create NO highlight. Persisting is the explicit Save action below.
  useEffect(() => {
    if (!open || !selection || existingHighlight) return
    let cancelled = false
    setTitleText(selection.selectionText)
    setNote('')
    setTags([])
    setExpanded(false)
    setGlossState({ status: 'loading' })

    // The dedup lookup reads synchronously from the cache, so we can settle the
    // preview-vs-saved mode (and thus `highlightId`) before any await.
    const cached = queryClient.getQueryData(orpcQuery.highlights.listBySession.key({ input: { sessionId } })) as
      | { data: CachedHighlight[] }
      | undefined
    const match = findCachedHighlight(cached?.data, selection)
    setHighlightId(match ? match.id : null)

    void (async () => {
      try {
        if (match) {
          // Saved mode: show cached metadata immediately, then refresh the gloss
          // (this also enriches old rows with Wiktionary IPA).
          setNote(match.note ?? '')
          setTags(match.presetTags ?? [])
          const cachedGloss = match.fastGloss ? parseFastGloss(match.fastGloss) : null
          if (cachedGloss) setGlossState({ status: 'ready', ...cachedGloss, ipaDisplay: null })
          try {
            const res = await fetchGloss({ sessionId, highlightId: match.id })
            if (cancelled) return
            setGlossState({
              status: 'ready',
              gloss: res.data.gloss,
              pos: res.data.pos,
              register: res.data.register,
              ipaDisplay: res.data.ipaDisplay,
            })
          } catch {
            if (!cancelled && !cachedGloss) setGlossState({ status: 'error', message: null })
          }
        } else {
          // Preview mode: free, stateless gloss — no highlight, no enrich job.
          const res = await fetchStatelessGloss({
            selectionText: selection.selectionText,
            contextLine: selection.contextLine,
            targetLanguage,
          })
          if (cancelled) return
          setGlossState({
            status: 'ready',
            gloss: res.data.gloss,
            pos: res.data.pos,
            register: res.data.register,
            ipaDisplay: res.data.ipaDisplay,
          })
        }
      } catch {
        if (!cancelled) setGlossState({ status: 'error', message: null })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    open,
    selection?.selectionText,
    selection?.startSegmentId,
    selection?.endSegmentId,
    selection?.startOffset,
    selection?.endOffset,
    selection?.contextLine,
    existingHighlight,
    sessionId,
    targetLanguage,
    fetchGloss,
    fetchStatelessGloss,
    queryClient,
  ])

  // Explicit Save: the only thing that persists a highlight (and fires the
  // enrich/card job). Flips the sheet from preview into saved mode; the gloss
  // already on screen stays. Note/tags editing then unlocks behind `highlightId`.
  const handleSave = useCallback(async () => {
    // isSaving guards the right-click shortcut: the sheet now stays open
    // through it, so a repeated right-click would otherwise double-create.
    if (!selection || highlightId || isSaving) return
    setIsSaving(true)
    try {
      const created = await createHighlight({
        sessionId,
        startSegmentId: selection.startSegmentId,
        endSegmentId: selection.endSegmentId,
        startOffset: selection.startOffset,
        endOffset: selection.endOffset,
        selectionText: selection.selectionText,
        note: null,
        presetTags: [],
        // Touched study options ride the save; the enrichment job applies them
        // once the term materializes. Untouched → undefined → backend default.
        studyIntent: draftToStudyIntent(studyDraft),
        // A pre-save ghost adoption dismisses the ghost with the insert.
        adoptedGhostId: pendingGhostId ?? undefined,
      })
      setHighlightId(created.data.id)
    } catch {
      // The mutation's meta.errorMessage surfaces a toast; stay in preview mode.
    } finally {
      setIsSaving(false)
    }
  }, [selection, highlightId, isSaving, createHighlight, sessionId, studyDraft, pendingGhostId])

  // Atomic span swap: drop the provisional highlight the literal selection created
  // and replace it with the ghost's span (one backend transaction), then re-point
  // the sheet at the new highlight and reload its gloss. Done explicitly here rather
  // than via the selection-keyed effect to avoid any window where a stale highlight
  // cache could create a duplicate.
  const handleUseSuggested = async () => {
    if (!suggestedGhost || !highlightId) return
    try {
      const res = await switchGhost({ sessionId, ghostId: suggestedGhost.id, provisionalHighlightId: highlightId })
      setAdopted(true)
      const newId = res.data.id
      setHighlightId(newId)
      setTitleText(res.data.selectionText)
      setNote(res.data.note ?? '')
      setTags(res.data.presetTags ?? [])
      setGlossState({ status: 'loading' })
      const gloss = await fetchGloss({ sessionId, highlightId: newId })
      setGlossState({
        status: 'ready',
        gloss: gloss.data.gloss,
        pos: gloss.data.pos,
        register: gloss.data.register,
        ipaDisplay: gloss.data.ipaDisplay,
      })
    } catch {
      setGlossState({ status: 'error', message: null })
    }
  }

  // Hoisted so the lingui message uses a plain ${placeholder}, not a member access.
  const suggestedSurface = suggestedGhost?.surfaceForm ?? ''

  // `morphToPreview` (the right-click toggle) keeps the sheet open after the
  // delete and flips it back to preview mode for the same selection — the
  // toggle's visible counterpart to Save morphing preview → saved. Only
  // possible when the sheet holds a live SelectionResult (a fresh selection
  // that matched a saved row); a sheet opened from a highlight click has no
  // selection to preview, so it closes as before.
  const handleRemove = useCallback(
    (opts?: { morphToPreview?: boolean }) => {
      // isDeleting guards the right-click shortcut — the button is disabled,
      // but a repeated right-click would otherwise fire a second delete (a 404).
      if (!highlightId || isDeleting) return
      deleteHighlight(
        { sessionId, highlightId },
        {
          onSuccess: () => {
            if (opts?.morphToPreview && selection && !existingHighlight) {
              // Back to preview: same selection, nothing persisted anymore. The
              // gloss on screen stays (same text); the removed row's note/tags
              // must not leak into a future re-save.
              setHighlightId(null)
              setNote('')
              setTags([])
              setExpanded(false)
            } else {
              onClose()
            }
          },
        }
      )
    },
    [highlightId, isDeleting, deleteHighlight, sessionId, selection, existingHighlight, onClose]
  )

  const handleSaveNote = () => {
    if (!highlightId) return
    saveNoteAndTags(
      {
        sessionId,
        highlightId,
        note: note.trim() || null,
        presetTags: tags,
        chatSeedPrompt: composeChatSeedPrompt(tags, presetPrompts, note),
      },
      {
        onSuccess: () => {
          setExpanded(false)
        },
      }
    )
  }

  const toggleTag = (tag: PresetTag) => {
    setTags((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]))
  }

  const isReady = glossState.status === 'ready'
  // Preview mode = a fresh, unsaved selection. The gloss is a free, ephemeral
  // lookup; nothing is persisted until the user clicks Save. Saved mode (an
  // existing highlight or a just-saved selection) keeps the Remove/note actions.
  const isPreview = !!selection && !existingHighlight && !highlightId
  const hasNoteDetails = note.trim().length > 0 || tags.length > 0

  // Right-click while the sheet is open is the toggle power-shortcut that
  // mirrors the extension's right-click-to-save: in preview mode it saves the
  // selection the sheet refers to, in saved mode it removes the highlight —
  // so right-click, right-click on the same word cycles save → remove.
  //
  // The sheet STAYS OPEN through the toggle and morphs in place (preview ⇄
  // saved) — FloatingSheet ignores right-button pointerdowns as a dismiss
  // gesture, so the action is visible in the sheet instead of the sheet
  // vanishing mid-cycle.
  //
  // We act on the right-button `pointerdown`, NOT `contextmenu`: the
  // word-selection hook suppresses `contextmenu` inside the reader, and
  // handling the initial press keeps this in the same dispatch as the
  // (now-cancelled) outside-pointerdown dismissal.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 2) return
      e.preventDefault()
      if (isPreview) void handleSave()
      else handleRemove({ morphToPreview: true })
    }
    document.addEventListener('pointerdown', onPointerDown, { capture: true })
    return () => document.removeEventListener('pointerdown', onPointerDown, { capture: true })
  }, [open, isPreview, handleSave, handleRemove])
  const englishIpaDialect = userPrefs?.englishIpaDialect ?? 'ga'
  // Server-picked, dialect-correct display string — no client-side bag picking.
  // The prefs read above still feeds the EnglishIpaDialectFlag next to it.
  const displayedIpa = isReady ? (glossState as Extract<GlossViewState, { status: 'ready' }>).ipaDisplay : null
  const hasWiktionaryData = KAIKKI_LANGUAGES.has(targetLanguage)
  const ipaLabel = isReady ? (displayedIpa ?? (hasWiktionaryData ? t`No Wiktionary IPA` : null)) : null
  const showIpaFlag = !!displayedIpa && targetLanguage === 'en'

  // Description fallback for accessibility — the title is the selection text,
  // which doesn't describe the sheet's purpose.
  const ariaDescription = useMemo(() => {
    if (isReady) return (glossState as Extract<GlossViewState, { status: 'ready' }>).gloss
    return t`Quick gloss for the selected text.`
  }, [isReady, glossState, t])

  return (
    <FloatingSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      anchor={anchor}
      expandable
      expanded={expanded}
      onExpandedChange={setExpanded}
      modal={false}
      closeOnScroll
    >
      <FloatingSheetContent>
        <FloatingSheetHeader>
          <div className='flex items-start justify-between gap-2'>
            <div className='flex min-w-0 flex-col gap-1'>
              <FloatingSheetTitle className='truncate'>{titleText || t`Quick gloss`}</FloatingSheetTitle>
              <GlossCardBody
                loading={glossState.status === 'loading'}
                gloss={isReady ? (glossState as Extract<GlossViewState, { status: 'ready' }>).gloss : null}
                pos={isReady ? (glossState as Extract<GlossViewState, { status: 'ready' }>).pos : null}
                register={isReady ? (glossState as Extract<GlossViewState, { status: 'ready' }>).register : null}
                ipaLabel={ipaLabel}
                ipaPrefix={
                  showIpaFlag ? (
                    <EnglishIpaDialectFlag targetLanguage={targetLanguage} englishIpaDialect={englishIpaDialect} />
                  ) : undefined
                }
                srDescription={ariaDescription}
              />
            </div>
            {/* Notes attach to a saved highlight, so the expand toggle only
                appears once we're in saved mode (not during a free preview). */}
            {!isPreview && (
              <FloatingSheetExpandToggle
                className='hover:bg-accent text-muted-foreground rounded-md p-1 transition-colors'
                ariaLabel={expanded ? t`Hide notes` : t`Show notes`}
              >
                {(isExpanded, isMobile) => {
                  // Mobile drawer grows upward visually → up arrow invites the
                  // expand. Desktop popover grows downward inside its content
                  // box → down arrow invites the expand. Either way the icon
                  // flips on toggle.
                  const pointsUp = isMobile ? !isExpanded : isExpanded
                  return pointsUp ? <ChevronUp className='h-4 w-4' /> : <ChevronDown className='h-4 w-4' />
                }}
              </FloatingSheetExpandToggle>
            )}
          </div>
        </FloatingSheetHeader>

        {suggestedGhost && !adopted && (
          <FloatingSheetBody>
            {/* Label sits above the button; the button itself stays understated. Still
                full-width so it's an easy tap target on mobile. In preview mode the
                tap swaps the LOCAL selection (nothing saved yet); in saved mode it
                runs the server-side ghosts.switch span swap. */}
            <p className='text-muted-foreground mb-1.5 text-xs font-medium'>{t`Use suggested`}</p>
            <Button
              type='button'
              variant='outline'
              className='w-full justify-center'
              disabled={isSwitching}
              onClick={() => {
                if (isPreview) {
                  onAdoptGhostPreSave(suggestedGhost)
                } else {
                  void handleUseSuggested()
                }
              }}
            >
              {isSwitching ? t`Switching…` : suggestedSurface}
            </Button>
          </FloatingSheetBody>
        )}

        {isPreview && selection && (
          <FloatingSheetBody>
            <StudyOptionsSection
              // Remounting per selection re-collapses the disclosure; the draft
              // itself lives above and survives a ghost swap (skills kept,
              // exact-form re-armed).
              key={`${selection.startSegmentId}:${selection.startOffset}:${selection.selectionText}`}
              value={studyDraft}
              onChange={setStudyDraft}
              surfaceForm={selection.selectionText}
            />
          </FloatingSheetBody>
        )}

        {glossState.status === 'error' && (
          <FloatingSheetBody>
            <p className='text-destructive'>
              {isPreview ? t`Could not fetch a gloss.` : t`Could not fetch a gloss. The highlight is still saved.`}
            </p>
          </FloatingSheetBody>
        )}

        <FloatingSheetExpanded>
          <HighlightNoteEditor note={note} tags={tags} onNoteChange={setNote} onToggleTag={toggleTag} />
        </FloatingSheetExpanded>

        <FloatingSheetFooter>
          <div className='flex items-center justify-between gap-2'>
            {isPreview ? (
              // Preview mode: looking is free, and clicking outside already
              // discards — no Cancel button. Save is the explicit action that
              // persists the highlight and fires the enrich/card job.
              <Button type='button' size='xl' className='w-full' disabled={isSaving} onClick={() => void handleSave()}>
                <Save className='mr-1 h-4 w-4' />
                {isSaving ? t`Saving…` : t`Save`}
              </Button>
            ) : (
              <>
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  disabled={isDeleting || !highlightId}
                  onClick={() => handleRemove()}
                  className='text-destructive hover:bg-destructive/10'
                >
                  <Trash2 className='mr-1 h-4 w-4' />
                  {isDeleting ? t`Removing…` : t`Remove highlight`}
                </Button>
                {expanded ? (
                  <Button type='button' size='sm' disabled={isSavingNote || !highlightId} onClick={handleSaveNote}>
                    {isSavingNote ? t`Saving…` : t`Save note`}
                  </Button>
                ) : (
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    disabled={!highlightId}
                    onClick={() => setExpanded(true)}
                  >
                    <PencilLine className='h-4 w-4' />
                    {hasNoteDetails ? t`Edit note` : t`Add note`}
                  </Button>
                )}
              </>
            )}
          </div>
        </FloatingSheetFooter>
      </FloatingSheetContent>
    </FloatingSheet>
  )
}

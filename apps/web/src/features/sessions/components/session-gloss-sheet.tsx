import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import { Check, ChevronLeft, Eye, Lightbulb, PencilLine, Save, Trash2 } from 'lucide-react'
import { KAIKKI_LANGUAGES } from '@flicktionary/core/constants/language-grammar'
import { parseFastGloss } from '@flicktionary/core/utils/parse-fast-gloss'
import type { GlossViewState } from '@flicktionary/core/types/gloss-view-state'
import type { GhostCandidate } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { orpcQuery } from '@/lib/transport/orpc-client'
import { POSTHOG_EVENTS } from '@/lib/analytics/posthog-events'
import { Button } from '@flicktionary/ui/components/button'
import { GlossCardBody } from '@flicktionary/ui/components/gloss-card-body'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@flicktionary/ui/components/tooltip'
import { composeChatSeedPrompt, usePresetTagTexts, type PresetTag } from '@flicktionary/ui/components/preset-tags'
import { HighlightNoteEditor } from '@flicktionary/ui/components/highlight-note-editor'
import {
  StudyOptionsSection,
  defaultStudyIntentDraft,
  draftToStudyIntent,
  type StudyIntentDraft,
} from '@flicktionary/ui/components/study-options-section'
import { IpaDialectFlag } from '@/components/ipa-dialect-flag'
import { ipaDialectsFromPrefs } from '@flicktionary/core/utils/pick-ipa'
import {
  FloatingSheet,
  FloatingSheetBody,
  FloatingSheetContent,
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
  useSaveWord,
  useStatelessGloss,
  useWordFamilyInsight,
  useRecordLookup,
  useSwitchGhost,
  useUpdateHighlightNoteAndTags,
} from '../api/sessions-hooks'
import { SavedStudyTargets } from './saved-study-targets'
import { KnownLemmaChip } from './known-lemma-chip'
import { WordFamilyLine } from './word-family-line'
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
  // `selection` is the span the sheet refers to. For a fresh mouseup/touchend it
  // starts in preview mode; for a click on an already-saved highlight,
  // `existingHighlight` is also set so the sheet opens in saved mode while still
  // being able to morph back to preview after Remove.
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

const selectionIdentity = (selection: SelectionResult): string =>
  `${selection.startSegmentId}:${selection.endSegmentId}:${selection.startOffset}:${selection.endOffset}:${selection.selectionText}`

type ReadyGloss = Extract<GlossViewState, { status: 'ready' }>

// A fastGloss response (highlight-bound or stateless) as the sheet's ready state.
const readyGlossFrom = (data: Omit<ReadyGloss, 'status'>): ReadyGloss => ({
  status: 'ready',
  gloss: data.gloss,
  pos: data.pos,
  register: data.register,
  ipaDisplay: data.ipaDisplay,
  ipaLemma: data.ipaLemma,
  knownLemmaCandidates: data.knownLemmaCandidates,
  wordFamily: data.wordFamily,
})

// A saved row's persisted gloss, shown instantly while the fetch refreshes it
// (the refresh adds the IPA and known-lemma candidates).
const cachedReadyGloss = (fastGloss: string | null): ReadyGloss | null =>
  fastGloss ? { status: 'ready', ...parseFastGloss(fastGloss), ipaDisplay: null, ipaLemma: null } : null

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
  const { mutate: recordLookup } = useRecordLookup()
  const { mutate: deleteHighlight, isPending: isDeleting } = useDeleteHighlight(sessionId)
  const { mutate: saveNoteAndTags, isPending: isSavingNote } = useUpdateHighlightNoteAndTags(sessionId)
  const { mutateAsync: switchGhost, isPending: isSwitching } = useSwitchGhost(sessionId)
  const { mutateAsync: saveWord, isPending: isSavingWord } = useSaveWord(sessionId)

  const { prompts: presetPrompts } = usePresetTagTexts()

  const [glossState, setGlossState] = useState<GlossViewState>({ status: 'idle' })
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [titleText, setTitleText] = useState<string>('')
  const [note, setNote] = useState('')
  const [tags, setTags] = useState<string[]>([])
  // The sheet's inner "note view": Add note navigates the whole sheet content
  // (header/body/footer) to the note editor, with a back chevron to return —
  // instead of expanding the editor inline below the study options.
  const [noteViewOpen, setNoteViewOpen] = useState(false)
  const [sheetExpanded, setSheetExpanded] = useState(false)
  const [locallyRemovedHighlightId, setLocallyRemovedHighlightId] = useState<string | null>(null)
  // True the instant a note/preset Save lands, so the editor locks without
  // waiting for the listBySession refetch to surface the committed note. Reset on
  // every (re)open / selection change.
  const [localNoteSaved, setLocalNoteSaved] = useState(false)
  // Set once a ghost has been adopted in this open session, to hide the action.
  const [adopted, setAdopted] = useState(false)
  // True while an explicit Save (preview → saved) is creating the highlight.
  const [isSaving, setIsSaving] = useState(false)
  // The "Study options" draft. Untouched → no studyIntent on Save (the backend
  // keep-time default applies); touched → the FULL SET of checked skills.
  const [studyDraft, setStudyDraft] = useState<StudyIntentDraft>(defaultStudyIntentDraft)
  const preservedPreviewGlossRef = useRef<{ selectionKey: string; state: GlossViewState } | null>(null)
  // Guess-before-reveal: the selection whose held-back translation the reader
  // revealed. Ephemeral — keyed to the selection, reset on every (re)open.
  const [revealedSelectionKey, setRevealedSelectionKey] = useState<string | null>(null)
  // A second tap on the same word while the sheet is open reveals too. Each
  // tap hands over a NEW selection object, so an identity-equal swap while the
  // sheet stays open is exactly that re-tap (the "adjust state on prop change"
  // pattern — no effect needed).
  const [previousSelectionProps, setPreviousSelectionProps] = useState({ open, selection })
  if (previousSelectionProps.open !== open || previousSelectionProps.selection !== selection) {
    const prev = previousSelectionProps.selection
    if (!previousSelectionProps.open && open) {
      setRevealedSelectionKey(null)
    } else if (open && prev && selection && prev !== selection) {
      const key = selectionIdentity(selection)
      if (selectionIdentity(prev) === key) setRevealedSelectionKey(key)
    }
    setPreviousSelectionProps({ open, selection })
  }

  // The saved highlight's live row, used to drive the always-visible study
  // targets: `studyIntent` (pre-enrich) and `chunkId` (post-enrich). We poll
  // while the open sheet's highlight is still pre-enrich (chunkId == null, which
  // the server keeps reporting until the enrich job finishes) so the study
  // targets flip to the live facets without a manual refresh.
  const { data: sessionHighlights } = useQuery(
    orpcQuery.highlights.listBySession.queryOptions({
      input: { sessionId },
      enabled: open,
      select: (response) => response.data,
      refetchInterval: (query) => {
        const row = query.state.data?.data.find((h) => h.id === highlightId)
        return open && highlightId && row && row.chunkId == null ? 2000 : false
      },
    })
  )
  const currentHighlight = highlightId ? (sessionHighlights?.find((h) => h.id === highlightId) ?? null) : null
  const activeExistingHighlight = existingHighlight?.id === locallyRemovedHighlightId ? null : existingHighlight
  // "Note saved, word NOT saved": the highlight is a note-only stub (its card is
  // parked in needs_data). The sheet keeps the study options editable and offers
  // Save to upgrade.
  const isNoteOnlyStub = !!currentHighlight?.noteOnly

  useEffect(() => {
    /* eslint-disable react-you-might-not-need-an-effect/no-event-handler, react-you-might-not-need-an-effect/no-adjust-state-on-prop-change -- clears the save→remove cycle tracking on CLOSE; the sheet stays mounted and closes through several paths (outside tap, Escape, swipe-down), so keying on `open` covers them all */
    if (open) return
    setLocallyRemovedHighlightId(null)
    preservedPreviewGlossRef.current = null
    /* eslint-enable react-you-might-not-need-an-effect/no-event-handler, react-you-might-not-need-an-effect/no-adjust-state-on-prop-change */
  }, [open])

  // Preview mode = a fresh, unsaved selection. The gloss is a free, ephemeral
  // lookup; nothing is persisted until the user clicks Save / Save note. Saved
  // mode (an existing highlight or a just-saved selection) keeps Remove/note.
  const isPreview = !!selection && !activeExistingHighlight && !highlightId

  // Identity keys for the seed effect below: every tap hands over a new
  // selection object and every listBySession refetch rebuilds the existing
  // highlight's, and neither may reset the sheet — a re-tap on the same word
  // reveals a held-back translation, and a refetch mid-edit must not kick the
  // user out of the note view.
  const selectionKey = selection ? selectionIdentity(selection) : null
  const activeExistingHighlightId = activeExistingHighlight?.id ?? null

  // Seeds the sheet whenever it (re)opens or its subject changes, then fetches
  // the gloss. Preview-first: looking is free and ephemeral.
  //  - A saved highlight (the clicked one, or a cached row matching the
  //    selection so a re-tap doesn't create a duplicate) → saved mode: its
  //    cached gloss/note/tags at once, then the highlight-bound fastGloss
  //    (which also adds Wiktionary IPA to old rows).
  //  - Otherwise → preview mode: a FREE stateless gloss and NO highlight.
  //    Persisting is the explicit Save action below.
  // An effect rather than a key-remount or an event handler: the sheet stays
  // mounted across opens, tapping another word WHILE it is open swaps its
  // content in place (no close/reopen flash), and the save/remove morph must
  // survive without a remount. A layout effect so the swap lands before paint
  // (no frame of the previous word's content).
  useLayoutEffect(() => {
    if (!open) return
    setNoteViewOpen(false)
    setSheetExpanded(false)
    setLocalNoteSaved(false)
    setAdopted(false)
    setIsSaving(false)
    // Fresh open / new gesture selection → full reset. A pre-save ghost
    // adoption swaps the selection too (pendingGhostId set in the same render):
    // the skill choices are about the word, so they survive the swap, but the
    // exact-form toggle is re-armed — its referent (the surface) just changed.
    setStudyDraft((prev) => (pendingGhostId ? { ...prev, exactForm: false } : defaultStudyIntentDraft))

    let saved: ExistingHighlightInput | null = activeExistingHighlight
    if (!saved && selection) {
      const cached = queryClient.getQueryData(orpcQuery.highlights.listBySession.key({ input: { sessionId } })) as
        { data: CachedHighlight[] } | undefined
      const match = findCachedHighlight(cached?.data, selection)
      saved = match?.id === locallyRemovedHighlightId ? null : match
    }

    let cancelled = false
    if (saved) {
      const cachedGloss = cachedReadyGloss(saved.fastGloss)
      setHighlightId(saved.id)
      setTitleText(saved.selectionText)
      setNote(saved.note ?? '')
      setTags(saved.presetTags)
      setGlossState(cachedGloss ?? { status: 'loading' })
      fetchGloss({ sessionId, highlightId: saved.id }).then(
        (res) => {
          if (!cancelled) setGlossState(readyGlossFrom(res.data))
        },
        () => {
          if (!cancelled && !cachedGloss) setGlossState({ status: 'error', message: null })
        }
      )
    } else if (selection) {
      setHighlightId(null)
      setTitleText(selection.selectionText)
      setNote('')
      setTags([])
      // Removed in place (the save→remove morph): the gloss already on screen
      // is for this very selection, so it stays and nothing is re-fetched.
      const preservedGloss =
        locallyRemovedHighlightId && preservedPreviewGlossRef.current?.selectionKey === selectionKey
          ? preservedPreviewGlossRef.current.state
          : null
      if (preservedGloss) {
        setGlossState(preservedGloss)
      } else {
        setGlossState({ status: 'loading' })
        // Opening the sheet on a word is an explicit lookup: a demand signal.
        recordLookup({ selectionText: selection.selectionText, targetLanguage })
        fetchStatelessGloss({
          selectionText: selection.selectionText,
          contextLine: selection.contextLine,
          targetLanguage,
          includeWordFamily: true,
        }).then(
          (res) => {
            if (!cancelled) setGlossState(readyGlossFrom(res.data))
          },
          () => {
            if (!cancelled) setGlossState({ status: 'error', message: null })
          }
        )
      }
    }
    return () => {
      cancelled = true
    }
  }, [
    open,
    activeExistingHighlightId,
    selectionKey,
    pendingGhostId,
    locallyRemovedHighlightId,
    sessionId,
    targetLanguage,
    fetchGloss,
    fetchStatelessGloss,
    recordLookup,
    queryClient,
  ])

  // Shared builder so the plain Save lane and the note-only Save-note lane build
  // identical create args (span + fastGloss + note/tags). `noteOnly` flips the
  // lane: the note-only lane skips study facets entirely (studyIntent omitted)
  // and the backend creates an empty stub card instead of running enrichment. A
  // typed note rides along in BOTH lanes and seeds the card chat once.
  const buildCreateArgs = useCallback(
    (noteOnly: boolean) => {
      if (!selection) return null
      const fastGloss =
        glossState.status === 'ready'
          ? { gloss: glossState.gloss, pos: glossState.pos, register: glossState.register }
          : undefined
      return {
        sessionId,
        startSegmentId: selection.startSegmentId,
        endSegmentId: selection.endSegmentId,
        startOffset: selection.startOffset,
        endOffset: selection.endOffset,
        selectionText: selection.selectionText,
        note: note.trim() || null,
        presetTags: tags,
        chatSeedPrompt: composeChatSeedPrompt(tags, presetPrompts, note),
        // Note-only ignores skill selection; the plain lane applies touched
        // study options once the term materializes (untouched → undefined →
        // backend default).
        studyIntent: noteOnly ? undefined : draftToStudyIntent(studyDraft),
        // A pre-save ghost adoption dismisses the ghost with the insert.
        adoptedGhostId: pendingGhostId ?? undefined,
        noteOnly,
        ...(fastGloss ? { fastGloss } : {}),
      }
    },
    [selection, glossState, sessionId, note, tags, presetPrompts, studyDraft, pendingGhostId]
  )

  // Explicit Save (main lane): persists a full highlight + fires the enrich/card
  // job. Flips the sheet from preview into saved mode; the gloss already on
  // screen stays. A note typed before saving rides along and seeds the chat once
  // (locking the editor). Note/tags editing then unlocks behind `highlightId`.
  const handleSave = useCallback(async () => {
    // isSaving guards the right-click shortcut: the sheet now stays open
    // through it, so a repeated right-click would otherwise double-create.
    if (!selection || highlightId || isSaving) return
    const args = buildCreateArgs(false)
    if (!args) return
    setIsSaving(true)
    try {
      const created = await createHighlight(args)
      setHighlightId(created.data.id)
      POSTHOG_EVENTS.vocabularyTermSaved({ target_language: targetLanguage })
      // A committed note seeds the chat once — lock the editor (matches the
      // note-only lane). An empty save leaves it editable.
      if (args.chatSeedPrompt) setLocalNoteSaved(true)
      setNoteViewOpen(false)
      setSheetExpanded(false)
    } catch {
      // The mutation's meta.errorMessage surfaces a toast; stay in preview mode.
    } finally {
      setIsSaving(false)
    }
  }, [selection, highlightId, isSaving, createHighlight, buildCreateArgs, targetLanguage])

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
      setGlossState(readyGlossFrom(gloss.data))
    } catch {
      setGlossState({ status: 'error', message: null })
    }
  }

  // Hoisted so the lingui message uses a plain ${placeholder}, not a member access.
  // The suggested surface form can be a long phrase, so it lives in the sheet's
  // morph (the saved span) rather than the tooltip label, which stays short.
  const useSuggestedLabel = t`Use suggested term`

  // `morphToPreview` keeps the sheet open after the delete and flips it back to
  // preview mode for the same selection — the visible counterpart to Save
  // morphing preview → saved. It needs a SelectionResult so the preview can be
  // saved again; callers without one still close after deletion.
  const handleRemove = useCallback(
    (opts?: { morphToPreview?: boolean }) => {
      // isDeleting guards the right-click shortcut — the button is disabled,
      // but a repeated right-click would otherwise fire a second delete (a 404).
      if (!highlightId || isDeleting) return
      const removedId = highlightId
      deleteHighlight(
        { sessionId, highlightId },
        {
          onSuccess: () => {
            if (opts?.morphToPreview && selection) {
              // Back to preview: same selection, nothing persisted anymore. The
              // gloss on screen stays (same text); the removed row's note/tags
              // must not leak into a future re-save.
              setLocallyRemovedHighlightId(removedId)
              preservedPreviewGlossRef.current =
                glossState.status === 'ready' ? { selectionKey: selectionIdentity(selection), state: glossState } : null
              setHighlightId(null)
              setNote('')
              setTags([])
              setNoteViewOpen(false)
              setSheetExpanded(false)
              setLocalNoteSaved(false)
            } else {
              onClose()
            }
          },
        }
      )
    },
    [highlightId, isDeleting, deleteHighlight, sessionId, selection, glossState, onClose]
  )

  // Save note: the note-only commit lane. In preview (nothing saved yet) it
  // creates a NEW highlight with noteOnly=true — an empty stub card that exists
  // only to host the seeded chat answer (no basic-data pass, no study facets).
  // On an already-saved highlight it just patches the note/tags via
  // updateNoteAndTags. Either way a committed note seeds the chat once and locks.
  const handleSaveNote = useCallback(async () => {
    if (isPreview) {
      if (!selection || isSaving) return
      const args = buildCreateArgs(true)
      if (!args) return
      setIsSaving(true)
      try {
        const created = await createHighlight(args)
        setHighlightId(created.data.id)
        if (args.chatSeedPrompt) setLocalNoteSaved(true)
        setNoteViewOpen(false)
        setSheetExpanded(false)
      } catch {
        // meta.errorMessage surfaces a toast; stay in preview.
      } finally {
        setIsSaving(false)
      }
      return
    }
    if (!highlightId) return
    const chatSeedPrompt = composeChatSeedPrompt(tags, presetPrompts, note)
    saveNoteAndTags(
      {
        sessionId,
        highlightId,
        note: note.trim() || null,
        presetTags: tags,
        chatSeedPrompt,
      },
      {
        onSuccess: () => {
          setNoteViewOpen(false)
          setSheetExpanded(false)
          // Lock the editor the moment a note/preset is committed: it seeds the
          // card chat once and can't be edited again (delete the highlight to
          // redo). An empty save (no note, no presets) seeds nothing and stays
          // editable so the user can still add one.
          if (chatSeedPrompt) setLocalNoteSaved(true)
        },
      }
    )
  }, [
    isPreview,
    selection,
    isSaving,
    buildCreateArgs,
    createHighlight,
    highlightId,
    tags,
    presetPrompts,
    note,
    saveNoteAndTags,
    sessionId,
  ])

  // Save on a note-only stub: upgrade it into a full study card — persist the
  // chosen study options and run the normal enrichment. The stub's card fills
  // in place, so the committed note and its seeded chat survive.
  const handleSaveWord = useCallback(async () => {
    if (!highlightId || isSavingWord) return
    try {
      await saveWord({ sessionId, highlightId, studyIntent: draftToStudyIntent(studyDraft) ?? null })
    } catch {
      // meta.errorMessage surfaces a toast. A CONFLICT means the word is
      // already saved — the listBySession refetch settles the sheet either way.
    }
  }, [highlightId, isSavingWord, saveWord, sessionId, studyDraft])

  const toggleTag = (tag: PresetTag) => {
    setTags((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]))
  }

  const readyGloss = glossState.status === 'ready' ? glossState : null
  const hasNoteDetails = note.trim().length > 0 || tags.length > 0

  // A note/preset committed to this highlight locks the editor read-only: it
  // seeds the card chat exactly once and re-saving would duplicate that turn, so
  // the only way to change it is to delete the highlight. Committed state is the
  // server row (currentHighlight, refetched after the save; existingHighlight as
  // the synchronous fallback on first open) plus localNoteSaved for the instant
  // after a save, before the refetch lands.
  const committedHasNote =
    (!!currentHighlight &&
      ((currentHighlight.note?.trim().length ?? 0) > 0 || currentHighlight.presetTags.length > 0)) ||
    (!!activeExistingHighlight &&
      ((activeExistingHighlight.note?.trim().length ?? 0) > 0 || activeExistingHighlight.presetTags.length > 0))
  const noteLocked = !!highlightId && (localNoteSaved || committedHasNote)

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
  const ipaDialects = ipaDialectsFromPrefs(userPrefs)
  // Server-picked, dialect-correct display string — no client-side bag picking.
  // The prefs read above still feeds the IpaDialectFlag next to it.
  const displayedIpa = readyGloss?.ipaDisplay ?? null
  // Only label the IPA with its lemma when there's an actual IPA to label (never
  // next to the "No Wiktionary IPA" fallback).
  const displayedIpaLemma = displayedIpa ? (readyGloss?.ipaLemma ?? null) : null
  const hasWiktionaryData = KAIKKI_LANGUAGES.has(targetLanguage)
  const ipaLabel = readyGloss ? (displayedIpa ?? (hasWiktionaryData ? t`No Wiktionary IPA` : null)) : null
  const showIpaFlag = !!displayedIpa && targetLanguage === 'en'

  // Word-family line: rides on both fastGloss responses (the server only fills
  // it for word-family languages with the setting on), so it stays put across
  // Save and reopen.
  const wordFamily = readyGloss?.wordFamily ?? null
  // The first tap of a word anyone has looked up generates its LLM insight
  // (what each part means here, parents kaikki lacks) after the line above
  // renders; the richer line then replaces it. Keyed on the word + POS, so the
  // result fetched in preview is reused after Save.
  const { data: insightWordFamily } = useWordFamilyInsight(
    wordFamily?.insightPending && readyGloss && titleText
      ? { selectionText: titleText, targetLanguage, pos: readyGloss.pos }
      : null
  )
  const displayedWordFamily =
    wordFamily?.insightPending && insightWordFamily !== undefined ? insightWordFamily : wordFamily
  // When a relative the reader already has is in the line, the translation
  // waits behind a reveal so they get a moment to infer the meaning first.
  // Preview only — a saved word was already looked up. Decided by the fastGloss
  // response, not the insight, so the reveal button never appears late.
  const isTranslationHeld =
    isPreview && !!wordFamily && wordFamily.anchors.length > 0 && revealedSelectionKey !== selectionKey
  const revealTranslation = useCallback(() => {
    if (selectionKey) setRevealedSelectionKey(selectionKey)
  }, [selectionKey])

  // Space reveals on desktop. Capture phase + preventDefault so it never also
  // scrolls the reader or presses whichever sheet button holds focus; typing a
  // note keeps its spaces.
  useEffect(() => {
    if (!open || !isTranslationHeld) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== ' ' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target instanceof HTMLElement ? e.target : null
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
      e.preventDefault()
      e.stopPropagation()
      revealTranslation()
    }
    document.addEventListener('keydown', onKeyDown, { capture: true })
    return () => document.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [open, isTranslationHeld, revealTranslation])

  // Description fallback for accessibility — the title is the selection text,
  // which doesn't describe the sheet's purpose.
  const ariaDescription = useMemo(() => {
    if (readyGloss && !isTranslationHeld) return readyGloss.gloss
    return t`Quick gloss for the selected text.`
  }, [readyGloss, isTranslationHeld, t])

  return (
    <FloatingSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      anchor={anchor}
      expandable
      expanded={sheetExpanded}
      onExpandedChange={setSheetExpanded}
      modal={false}
      closeOnScroll
      // A tap on a reader word / highlight swaps the open sheet's content in
      // place instead of dismissing + reopening it (no flash).
      ignoreOutsidePointerDownSelector='[data-word-start],[data-highlight-id]'
    >
      <FloatingSheetContent visualScrollAffordance desktopWidthClassName='w-88'>
        {/* The header/body/footer all swap between the MAIN view and the inner
            NOTE view (Add note → editor + back chevron, like the focus view's
            "Set up form" step). They swap content inside single Header/Footer
            elements because the mobile drawer pins direct FloatingSheetHeader/
            FloatingSheetFooter children by component type. */}
        {/* Note view: the drag-handle area above already provides mobile
            spacing, so drop the header's own top padding there (md: is the
            desktop popover, which has no handle and keeps it). */}
        <FloatingSheetHeader className={noteViewOpen ? 'pt-0 md:pt-3' : undefined}>
          {noteViewOpen ? (
            <>
              <div className='flex items-center gap-2'>
                {/* stopPropagation: the mobile header is a drag surface — a tap
                    on Back must navigate, not start a sheet drag. Negative
                    margins keep the 44px tap target from inflating the row. */}
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  aria-label={t`Back`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    setNoteViewOpen(false)
                    setSheetExpanded(false)
                  }}
                  className='-my-2 -ml-2 shrink-0'
                >
                  <ChevronLeft className='size-6 md:size-5' />
                </Button>
                <FloatingSheetTitle className='truncate'>{t`Add note`}</FloatingSheetTitle>
              </div>
              <p className='text-muted-foreground truncate text-sm'>{titleText}</p>
            </>
          ) : (
            <div className='flex items-start gap-2'>
              <div className='flex min-w-0 flex-1 flex-col gap-1'>
                <FloatingSheetTitle className='truncate'>{titleText || t`Quick gloss`}</FloatingSheetTitle>
                <GlossCardBody
                  loading={glossState.status === 'loading'}
                  gloss={readyGloss?.gloss ?? null}
                  pos={readyGloss?.pos ?? null}
                  register={readyGloss?.register ?? null}
                  ipaLabel={ipaLabel}
                  ipaLemma={displayedIpaLemma}
                  ipaPrefix={
                    showIpaFlag ? (
                      <IpaDialectFlag targetLanguage={targetLanguage} ipaDialects={ipaDialects} />
                    ) : undefined
                  }
                  srDescription={ariaDescription}
                  beforeGloss={displayedWordFamily ? <WordFamilyLine wordFamily={displayedWordFamily} /> : undefined}
                  glossReplacement={
                    isTranslationHeld ? (
                      // stopPropagation: the mobile header is a drag surface.
                      <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        className='mt-1 self-start'
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={revealTranslation}
                      >
                        <Eye className='mr-1 h-4 w-4' />
                        {t`Show translation`}
                        <kbd className='text-muted-foreground ml-2 hidden rounded border px-1 font-sans text-[10px] md:inline'>
                          {t`Space`}
                        </kbd>
                      </Button>
                    ) : undefined
                  }
                />
                {readyGloss && (
                  <KnownLemmaChip
                    targetLanguage={targetLanguage}
                    lemmas={readyGloss.knownLemmaCandidates ?? []}
                    onRemoved={() =>
                      setGlossState((prev) => (prev.status === 'ready' ? { ...prev, knownLemmaCandidates: [] } : prev))
                    }
                  />
                )}
              </div>
              {/* The LLM ghost suggestion is offered as an understated icon in the
                top-right (with a tooltip explaining it on desktop) rather than a
                full-width button — the suggested surface form can be a long phrase
                that overflows a button, and it declutters the sheet. Preview mode
                swaps the LOCAL selection (nothing saved yet); saved mode runs the
                server-side ghosts.switch span swap. `stopPropagation` keeps a tap
                from starting the header drag (the mobile header is a drag surface). */}
              {suggestedGhost && !adopted && (
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type='button'
                        variant='outline'
                        size='icon-sm'
                        className='shrink-0'
                        disabled={isSwitching}
                        aria-label={useSuggestedLabel}
                        onPointerDown={(e) => e.stopPropagation()}
                        // Swallow the focus the popover fires when it autofocuses
                        // this button on mount, so the tooltip doesn't self-open
                        // (radix-ui/primitives#2248). Hover still opens it.
                        onFocusCapture={(e) => e.stopPropagation()}
                        onClick={() => {
                          if (isPreview) onAdoptGhostPreSave(suggestedGhost)
                          else void handleUseSuggested()
                        }}
                      >
                        <Lightbulb className='h-4 w-4' />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side='left' sideOffset={6}>
                      {useSuggestedLabel}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          )}
        </FloatingSheetHeader>

        {noteViewOpen ? (
          <FloatingSheetBody className='gap-3'>
            <HighlightNoteEditor note={note} tags={tags} onNoteChange={setNote} onToggleTag={toggleTag} />
          </FloatingSheetBody>
        ) : (
          <>
            {/* Study targets are ALWAYS visible. Preview binds to the local draft
            (applied on Save); saved mode edits the highlight's stored intent
            pre-enrich, then its live facets once a chunkId resolves. */}
            {isPreview && selection ? (
              <FloatingSheetBody>
                <StudyOptionsSection
                  // Remounting per selection re-arms the draft; it lives above and
                  // survives a ghost swap (skills kept, exact-form re-armed).
                  key={`${selection.startSegmentId}:${selection.startOffset}:${selection.selectionText}`}
                  value={studyDraft}
                  onChange={setStudyDraft}
                  surfaceForm={selection.selectionText}
                />
              </FloatingSheetBody>
            ) : highlightId ? (
              <FloatingSheetBody>
                {isNoteOnlyStub ? (
                  // Note-only stub: the WORD isn't saved, so the study choice is
                  // still open — the editable preview picker, bound to the draft
                  // that Save (the upgrade) will apply.
                  <StudyOptionsSection
                    key={`stub-${highlightId}`}
                    value={studyDraft}
                    onChange={setStudyDraft}
                    surfaceForm={titleText}
                  />
                ) : (
                  <SavedStudyTargets
                    chunkId={currentHighlight?.chunkId ?? null}
                    storedIntent={currentHighlight?.studyIntent ?? null}
                    surfaceForm={titleText}
                  />
                )}
              </FloatingSheetBody>
            ) : null}

            {glossState.status === 'error' && (
              <FloatingSheetBody>
                <p className='text-destructive'>
                  {isPreview ? t`Could not fetch a gloss.` : t`Could not fetch a gloss. The highlight is still saved.`}
                </p>
              </FloatingSheetBody>
            )}

            {/* A committed note stays visible inline as passive context (read-only
            editor: saved note/chips + lock caption). EDITING an uncommitted
            note lives in the inner note view instead. */}
            {noteLocked && (
              <div className='flex flex-col gap-3 border-t px-2 pt-3 pb-2'>
                <HighlightNoteEditor note={note} tags={tags} onNoteChange={setNote} onToggleTag={toggleTag} readOnly />
              </div>
            )}
          </>
        )}

        <FloatingSheetFooter>
          {noteViewOpen ? (
            // Note view: ONE commit button. In preview it's the note-only lane
            // (empty stub card hosting the seeded chat — skill selection is
            // ignored); on a saved highlight it patches the note/tags. Disabled
            // until there's a note or preset — an empty commit would seed
            // nothing. A note kept as a draft (Back) still rides along with the
            // main Save.
            <Button
              type='button'
              size='xl'
              className='w-full'
              disabled={(isPreview ? isSaving : isSavingNote || !highlightId) || !hasNoteDetails}
              onClick={() => void handleSaveNote()}
            >
              {(isPreview ? isSaving : isSavingNote) ? t`Saving…` : t`Save note`}
            </Button>
          ) : (
            // A 2-column grid so every button cell is EXACTLY 50% in every state,
            // independent of label width or button count (flex-1's min-content
            // floor otherwise nudges the split by a pixel or two, and a lone
            // flex-1 button goes full-width). Buttons are w-full to fill the cell.
            <div className='grid grid-cols-2 gap-2'>
              {isPreview ? (
                // Preview mode: Save (full card — a drafted note rides along and
                // seeds the chat) + Add note (opens the inner note view; a dot
                // marks a pending draft). Looking is free and clicking outside
                // discards, so no Cancel.
                <>
                  <Button
                    type='button'
                    size='xl'
                    className='w-full'
                    disabled={isSaving}
                    onClick={() => void handleSave()}
                  >
                    <Save className='mr-1 h-4 w-4' />
                    {isSaving ? t`Saving…` : t`Save`}
                  </Button>
                  <Button
                    type='button'
                    variant='outline'
                    size='xl'
                    className='w-full'
                    disabled={isSaving}
                    onClick={() => {
                      setNoteViewOpen(true)
                      setSheetExpanded(true)
                    }}
                  >
                    <PencilLine className='mr-1 h-4 w-4' />
                    {hasNoteDetails ? t`Edit note` : t`Add note`}
                    {hasNoteDetails && <span aria-hidden className='bg-primary ml-1.5 h-1.5 w-1.5 rounded-full' />}
                  </Button>
                </>
              ) : isNoteOnlyStub ? (
                // Note-only stub: the note is committed but the WORD isn't
                // saved. Primary Save upgrades it into a full card with the
                // study options chosen above; the green "Note saved" mirrors
                // the Saved control — clicking it removes the stub (and its
                // chat) and morphs back to preview.
                <>
                  <Button
                    type='button'
                    size='xl'
                    className='w-full'
                    disabled={isSavingWord || !highlightId}
                    onClick={() => void handleSaveWord()}
                  >
                    <Save className='mr-1 h-4 w-4' />
                    {isSavingWord ? t`Saving…` : t`Save`}
                  </Button>
                  <button
                    type='button'
                    aria-label={t`Note saved — click to remove highlight`}
                    disabled={isDeleting || !highlightId}
                    onClick={() => handleRemove({ morphToPreview: true })}
                    // px-2 (not the Saved control's px-6): "Note saved" must fit
                    // its 50% cell on one line.
                    className='group hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive inline-flex h-12 w-full items-center justify-center gap-1.5 rounded-md border border-emerald-600/40 bg-emerald-50 px-2 text-base font-medium whitespace-nowrap text-emerald-700 transition-colors disabled:opacity-50'
                  >
                    <Check className='h-4 w-4 group-hover:hidden' />
                    <Trash2 className='hidden h-4 w-4 group-hover:block' />
                    <span className='group-hover:hidden'>{t`Note saved`}</span>
                    <span className='hidden group-hover:inline'>{t`Remove`}</span>
                  </button>
                </>
              ) : (
                // Saved mode: the cyclable green "Saved" — clicking it REMOVES
                // the highlight (mirrors the right-click toggle) — plus Add/Edit
                // note (inner note view) until a committed note locks.
                <>
                  {/* Cyclable Saved → Remove. Sized to match Button size='xl'
                      (h-12 px-6 text-base) + w-full so it fills its 50% grid cell. */}
                  <button
                    type='button'
                    aria-label={t`Saved — click to remove highlight`}
                    disabled={isDeleting || !highlightId}
                    onClick={() => handleRemove({ morphToPreview: true })}
                    className='group hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive inline-flex h-12 w-full items-center justify-center gap-1.5 rounded-md border border-emerald-600/40 bg-emerald-50 px-6 text-base font-medium text-emerald-700 transition-colors disabled:opacity-50'
                  >
                    <Check className='h-4 w-4 group-hover:hidden' />
                    <Trash2 className='hidden h-4 w-4 group-hover:block' />
                    <span className='group-hover:hidden'>{t`Saved`}</span>
                    <span className='hidden group-hover:inline'>{t`Remove`}</span>
                  </button>
                  {!noteLocked && (
                    <Button
                      type='button'
                      variant='outline'
                      size='xl'
                      className='w-full'
                      disabled={!highlightId}
                      onClick={() => {
                        setNoteViewOpen(true)
                        setSheetExpanded(true)
                      }}
                    >
                      <PencilLine className='mr-1 h-4 w-4' />
                      {hasNoteDetails ? t`Edit note` : t`Add note`}
                      {hasNoteDetails && <span aria-hidden className='bg-primary ml-1.5 h-1.5 w-1.5 rounded-full' />}
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
        </FloatingSheetFooter>
      </FloatingSheetContent>
    </FloatingSheet>
  )
}

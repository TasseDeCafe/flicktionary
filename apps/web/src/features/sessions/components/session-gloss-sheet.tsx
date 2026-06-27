import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import { Check, Lightbulb, PencilLine, Save, Trash2 } from 'lucide-react'
import { KAIKKI_LANGUAGES } from '@flicktionary/core/constants/language-grammar'
import { parseFastGloss } from '@flicktionary/core/utils/parse-fast-gloss'
import type { GlossViewState } from '@flicktionary/core/types/gloss-view-state'
import type { GhostCandidate } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { orpcQuery } from '@/lib/transport/orpc-client'
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
import { EnglishIpaDialectFlag } from '@/components/english-ipa-dialect-flag'
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
  useStatelessGloss,
  useSwitchGhost,
  useUpdateHighlightNoteAndTags,
} from '../api/sessions-hooks'
import { SavedStudyTargets } from './saved-study-targets'
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
  const [noteExpanded, setNoteExpanded] = useState(false)
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

  // The saved highlight's live row, used to drive the always-visible study
  // targets: `studyIntent` (pre-enrich) and `chunkId` (post-enrich). We poll
  // while the open sheet's highlight is still pre-enrich (chunkId == null) so the
  // study targets flip from intent-editing to live-facet editing without a manual
  // refresh once the enrich job materializes the term.
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

  useEffect(() => {
    if (open) return
    setLocallyRemovedHighlightId(null)
    preservedPreviewGlossRef.current = null
  }, [open])

  // Preview mode = a fresh, unsaved selection. The gloss is a free, ephemeral
  // lookup; nothing is persisted until the user clicks Save / Save note. Saved
  // mode (an existing highlight or a just-saved selection) keeps Remove/note.
  const isPreview = !!selection && !activeExistingHighlight && !highlightId

  useLayoutEffect(() => {
    if (!open) return
    setNoteExpanded(false)
    setSheetExpanded(false)
    setLocalNoteSaved(false)
    setAdopted(false)
    setIsSaving(false)
    // Fresh open / new gesture selection → full reset. A pre-save ghost
    // adoption swaps the selection too (pendingGhostId set in the same render):
    // the skill choices are about the word, so they survive the swap, but the
    // exact-form toggle is re-armed — its referent (the surface) just changed.
    setStudyDraft((prev) => (pendingGhostId ? { ...prev, exactForm: false } : defaultStudyIntentDraft))

    if (activeExistingHighlight) {
      setHighlightId(activeExistingHighlight.id)
      setTitleText(activeExistingHighlight.selectionText)
      setNote(activeExistingHighlight.note ?? '')
      setTags(activeExistingHighlight.presetTags)
      setGlossState(
        activeExistingHighlight.fastGloss
          ? { status: 'ready', ...parseFastGloss(activeExistingHighlight.fastGloss), ipaDisplay: null, ipaLemma: null }
          : { status: 'loading' }
      )
      return
    }

    if (selection) {
      setHighlightId(null)
      setTitleText(selection.selectionText)
      setNote('')
      setTags([])
      const preservedPreviewGloss =
        locallyRemovedHighlightId && preservedPreviewGlossRef.current?.selectionKey === selectionIdentity(selection)
          ? preservedPreviewGlossRef.current.state
          : null
      setGlossState(preservedPreviewGloss ?? { status: 'loading' })
    }
  }, [open, activeExistingHighlight, selection, pendingGhostId, locallyRemovedHighlightId])

  // Seed from the existing-highlight branch.
  useEffect(() => {
    if (!open || !activeExistingHighlight) return
    setHighlightId(activeExistingHighlight.id)
    setTitleText(activeExistingHighlight.selectionText)
    setNote(activeExistingHighlight.note ?? '')
    setTags(activeExistingHighlight.presetTags)
    setNoteExpanded(false)
    setSheetExpanded(false)
    const cachedGloss = activeExistingHighlight.fastGloss ? parseFastGloss(activeExistingHighlight.fastGloss) : null
    if (cachedGloss) {
      setGlossState({ status: 'ready', ...cachedGloss, ipaDisplay: null, ipaLemma: null })
    } else {
      setGlossState({ status: 'loading' })
    }
    // Fetch even when a cached gloss exists so old highlight rows can be
    // enriched with Wiktionary IPA without changing the fast_gloss column.
    let cancelled = false
    void (async () => {
      try {
        const res = await fetchGloss({ sessionId, highlightId: activeExistingHighlight.id })
        if (cancelled) return
        setGlossState({
          status: 'ready',
          gloss: res.data.gloss,
          pos: res.data.pos,
          register: res.data.register,
          ipaDisplay: res.data.ipaDisplay,
          ipaLemma: res.data.ipaLemma,
        })
      } catch {
        if (!cancelled && !cachedGloss) setGlossState({ status: 'error', message: null })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, activeExistingHighlight, sessionId, fetchGloss])

  // Seed from a fresh selection. Preview-first: looking is free and ephemeral.
  //  - If the selection matches an already-saved highlight → open in "saved"
  //    mode (its gloss/note/tags, Remove/Edit available).
  //  - Otherwise → open in "preview" mode: fetch a FREE stateless gloss and
  //    create NO highlight. Persisting is the explicit Save action below.
  useEffect(() => {
    if (!open || !selection || activeExistingHighlight) return
    let cancelled = false
    setTitleText(selection.selectionText)
    setNote('')
    setTags([])
    setNoteExpanded(false)
    setSheetExpanded(false)
    const preservedPreviewGloss =
      locallyRemovedHighlightId && preservedPreviewGlossRef.current?.selectionKey === selectionIdentity(selection)
        ? preservedPreviewGlossRef.current.state
        : null
    setGlossState(preservedPreviewGloss ?? { status: 'loading' })

    // The dedup lookup reads synchronously from the cache, so we can settle the
    // preview-vs-saved mode (and thus `highlightId`) before any await.
    const cached = queryClient.getQueryData(orpcQuery.highlights.listBySession.key({ input: { sessionId } })) as
      | { data: CachedHighlight[] }
      | undefined
    const cachedMatch = findCachedHighlight(cached?.data, selection)
    const match = cachedMatch?.id === locallyRemovedHighlightId ? null : cachedMatch
    setHighlightId(match ? match.id : null)

    void (async () => {
      try {
        if (match) {
          // Saved mode: show cached metadata immediately, then refresh the gloss
          // (this also enriches old rows with Wiktionary IPA).
          setNote(match.note ?? '')
          setTags(match.presetTags ?? [])
          const cachedGloss = match.fastGloss ? parseFastGloss(match.fastGloss) : null
          if (cachedGloss) setGlossState({ status: 'ready', ...cachedGloss, ipaDisplay: null, ipaLemma: null })
          try {
            const res = await fetchGloss({ sessionId, highlightId: match.id })
            if (cancelled) return
            setGlossState({
              status: 'ready',
              gloss: res.data.gloss,
              pos: res.data.pos,
              register: res.data.register,
              ipaDisplay: res.data.ipaDisplay,
              ipaLemma: res.data.ipaLemma,
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
            ipaLemma: res.data.ipaLemma,
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
    activeExistingHighlight,
    locallyRemovedHighlightId,
    sessionId,
    targetLanguage,
    fetchGloss,
    fetchStatelessGloss,
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
      // A committed note seeds the chat once — lock the editor (matches the
      // note-only lane). An empty save leaves it editable.
      if (args.chatSeedPrompt) setLocalNoteSaved(true)
      setNoteExpanded(false)
      setSheetExpanded(false)
    } catch {
      // The mutation's meta.errorMessage surfaces a toast; stay in preview mode.
    } finally {
      setIsSaving(false)
    }
  }, [selection, highlightId, isSaving, createHighlight, buildCreateArgs])

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
        ipaLemma: gloss.data.ipaLemma,
      })
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
              setNoteExpanded(false)
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
        setNoteExpanded(false)
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
          setNoteExpanded(false)
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

  const toggleTag = (tag: PresetTag) => {
    setTags((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]))
  }

  const isReady = glossState.status === 'ready'
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
  const englishIpaDialect = userPrefs?.englishIpaDialect ?? 'ga'
  // Server-picked, dialect-correct display string — no client-side bag picking.
  // The prefs read above still feeds the EnglishIpaDialectFlag next to it.
  const displayedIpa = isReady ? (glossState as Extract<GlossViewState, { status: 'ready' }>).ipaDisplay : null
  // Only label the IPA with its lemma when there's an actual IPA to label (never
  // next to the "No Wiktionary IPA" fallback).
  const displayedIpaLemma =
    isReady && displayedIpa ? (glossState as Extract<GlossViewState, { status: 'ready' }>).ipaLemma : null
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
      expanded={sheetExpanded}
      onExpandedChange={setSheetExpanded}
      modal={false}
      closeOnScroll
      // A tap on a reader word / highlight swaps the open sheet's content in
      // place instead of dismissing + reopening it (no flash).
      ignoreOutsidePointerDownSelector='[data-word-start],[data-highlight-id]'
    >
      <FloatingSheetContent visualScrollAffordance desktopWidthClassName='w-88'>
        <FloatingSheetHeader>
          <div className='flex items-start gap-2'>
            <div className='flex min-w-0 flex-1 flex-col gap-1'>
              <FloatingSheetTitle className='truncate'>{titleText || t`Quick gloss`}</FloatingSheetTitle>
              <GlossCardBody
                loading={glossState.status === 'loading'}
                gloss={isReady ? (glossState as Extract<GlossViewState, { status: 'ready' }>).gloss : null}
                pos={isReady ? (glossState as Extract<GlossViewState, { status: 'ready' }>).pos : null}
                register={isReady ? (glossState as Extract<GlossViewState, { status: 'ready' }>).register : null}
                ipaLabel={ipaLabel}
                ipaLemma={displayedIpaLemma}
                ipaPrefix={
                  showIpaFlag ? (
                    <EnglishIpaDialectFlag targetLanguage={targetLanguage} englishIpaDialect={englishIpaDialect} />
                  ) : undefined
                }
                srDescription={ariaDescription}
              />
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
        </FloatingSheetHeader>

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
            <SavedStudyTargets
              chunkId={currentHighlight?.chunkId ?? null}
              storedIntent={currentHighlight?.studyIntent ?? null}
              surfaceForm={titleText}
            />
          </FloatingSheetBody>
        ) : null}

        {glossState.status === 'error' && (
          <FloatingSheetBody>
            <p className='text-destructive'>
              {isPreview ? t`Could not fetch a gloss.` : t`Could not fetch a gloss. The highlight is still saved.`}
            </p>
          </FloatingSheetBody>
        )}

        {/* Locked notes render without an Edit affordance (the read-only editor
            shows the saved note/chips); an unsaved highlight shows the editable
            editor once the user opens it. */}
        {(noteExpanded || noteLocked) && (
          <div className='flex flex-col gap-3 border-t px-2 pt-3 pb-2'>
            <HighlightNoteEditor
              note={note}
              tags={tags}
              onNoteChange={setNote}
              onToggleTag={toggleTag}
              readOnly={noteLocked}
            />
          </div>
        )}

        <FloatingSheetFooter>
          {/* A 2-column grid so every button cell is EXACTLY 50% in every state,
              independent of label width or button count (flex-1's min-content
              floor otherwise nudges the split by a pixel or two, and a lone
              flex-1 button goes full-width). Buttons are w-full to fill the cell. */}
          <div className='grid grid-cols-2 gap-2'>
            {isPreview ? (
              // Preview mode: two commit lanes, both full-size and 50/50 wide
              // (no morph between closed/open note editor). Save = full card. Save
              // note = note-only (empty stub card hosting the seeded chat),
              // disabled until there's a note or preset — an empty note-only
              // save would make a useless data-less stub with no seeded chat.
              // Looking is free and clicking outside discards, so no Cancel.
              noteExpanded ? (
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
                    disabled={isSaving || !hasNoteDetails}
                    onClick={() => void handleSaveNote()}
                  >
                    {t`Save note`}
                  </Button>
                </>
              ) : (
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
                      setNoteExpanded(true)
                      setSheetExpanded(true)
                    }}
                  >
                    <PencilLine className='mr-1 h-4 w-4' />
                    {t`Add note`}
                  </Button>
                </>
              )
            ) : (
              // Saved mode. While composing a brand-new note (note editor open, not yet
              // locked) the left slot is "Save note"; otherwise it's the cyclable
              // green "Saved" — clicking it REMOVES the highlight (mirrors the
              // right-click toggle), replacing the old standalone trash button.
              <>
                {noteExpanded && !noteLocked ? (
                  <Button
                    type='button'
                    size='xl'
                    className='w-full'
                    disabled={isSavingNote || !highlightId}
                    onClick={() => void handleSaveNote()}
                  >
                    {isSavingNote ? t`Saving…` : t`Save note`}
                  </Button>
                ) : (
                  // Cyclable Saved → Remove. Sized to match Button size='xl'
                  // (h-12 px-6 text-base) + w-full so it fills its 50% grid cell.
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
                )}
                {!noteExpanded && !noteLocked && (
                  <Button
                    type='button'
                    variant='outline'
                    size='xl'
                    className='w-full'
                    disabled={!highlightId}
                    onClick={() => {
                      setNoteExpanded(true)
                      setSheetExpanded(true)
                    }}
                  >
                    <PencilLine className='mr-1 h-4 w-4' />
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

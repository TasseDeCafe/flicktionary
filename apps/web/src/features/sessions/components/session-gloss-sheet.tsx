import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import { ChevronDown, ChevronUp, PencilLine, Save, Trash2 } from 'lucide-react'
import { pickIpa } from '@flicktionary/core/utils/pick-ipa'
import { KAIKKI_LANGUAGES } from '@flicktionary/core/constants/language-grammar'
import type { GhostCandidate, GrammarIpaBag } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { orpcQuery } from '@/lib/transport/orpc-client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
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
} from '@/components/ui/floating-sheet'
import { Textarea } from '@/components/ui/textarea'
import {
  useCreateHighlight,
  useDeleteHighlight,
  useFastGloss,
  useGetUserPrefs,
  useStatelessGloss,
  useSwitchGhost,
  useUpdateHighlightNoteAndTags,
} from '../api/sessions-hooks'
import type { SelectionResult } from '../utils/selection-adapter'

const PRESET_TAGS = ['explain', '3_examples', 'synonyms', 'etymology', 'why_this_form'] as const
type PresetTag = (typeof PRESET_TAGS)[number]

export type ExistingHighlightInput = {
  id: string
  selectionText: string
  note: string | null
  presetTags: string[]
  fastGloss: string | null
}

type GlossState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; gloss: string; pos: string | null; register: string | null; ipa: GrammarIpaBag | null }
  | { kind: 'error' }

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
  anchor: FloatingSheetAnchor
  onClose: () => void
}

// Decodes the serialized fast_gloss column (gloss\n[POS]\n[register]) into the
// same shape the GlossPass endpoint returns.
const FAST_GLOSS_POS_ALIASES = new Set([
  'n',
  'noun',
  'v',
  'verb',
  'transitive verb',
  'intransitive verb',
  'phrasal verb',
  'modal verb',
  'adj',
  'adjective',
  'adv',
  'adverb',
  'prep',
  'preposition',
  'pron',
  'pronoun',
  'particle',
  'conj',
  'conjunction',
  'num',
  'numeral',
  'intj',
  'interjection',
])

const normalizeCachedMetadataToken = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_ -]/gu, '')
    .replace(/\s+/g, ' ')

const isCachedGlossPos = (value: string): boolean => FAST_GLOSS_POS_ALIASES.has(normalizeCachedMetadataToken(value))

const parseCachedGloss = (raw: string): { gloss: string; pos: string | null; register: string | null } => {
  const lines = raw.trim().split(/\r?\n/)
  const gloss = lines[0] ?? ''
  const metadata = lines
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const first = metadata[0] ?? null
  const second = metadata[1] ?? null

  if (first && isCachedGlossPos(first)) return { gloss, pos: first, register: second }
  if (second && isCachedGlossPos(second)) return { gloss, pos: second, register: first }
  return { gloss, pos: null, register: first }
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
// hook — only used here now.
const findCachedHighlight = (
  cached: CachedHighlight[] | undefined,
  selection: SelectionResult
): CachedHighlight | null => {
  if (!cached) return null
  return (
    cached.find(
      (h) =>
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

  const presetLabels: Record<PresetTag, string> = {
    explain: t`Explain`,
    '3_examples': t`3 examples`,
    synonyms: t`Synonyms`,
    etymology: t`Etymology`,
    why_this_form: t`Why this form?`,
  }

  // Localized natural-language phrasing for each preset, composed into the chat
  // question sent to the backend. Localizing here (in the UI locale) keeps the
  // backend language-agnostic; the model is told separately which language to
  // answer in (native, or target when translations are hidden).
  const presetPrompts: Record<PresetTag, string> = {
    explain: t`Explain this term in more depth.`,
    '3_examples': t`Give me three more example sentences using it.`,
    synonyms: t`What are some synonyms or near-synonyms, and how do they differ?`,
    etymology: t`What's the etymology or origin of this term?`,
    why_this_form: t`Why does it appear in this particular form here?`,
  }

  const [glossState, setGlossState] = useState<GlossState>({ kind: 'idle' })
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [titleText, setTitleText] = useState<string>('')
  const [note, setNote] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [expanded, setExpanded] = useState(false)
  // Set once a ghost has been adopted in this open session, to hide the action.
  const [adopted, setAdopted] = useState(false)
  // True while an explicit Save (preview → saved) is creating the highlight.
  const [isSaving, setIsSaving] = useState(false)

  useLayoutEffect(() => {
    if (!open) return
    setExpanded(false)
    setAdopted(false)
    setIsSaving(false)

    if (existingHighlight) {
      setHighlightId(existingHighlight.id)
      setTitleText(existingHighlight.selectionText)
      setNote(existingHighlight.note ?? '')
      setTags(existingHighlight.presetTags)
      setGlossState(
        existingHighlight.fastGloss
          ? { kind: 'ready', ...parseCachedGloss(existingHighlight.fastGloss), ipa: null }
          : { kind: 'loading' }
      )
      return
    }

    if (selection) {
      setHighlightId(null)
      setTitleText(selection.selectionText)
      setNote('')
      setTags([])
      setGlossState({ kind: 'loading' })
    }
  }, [open, existingHighlight, selection])

  // Seed from the existing-highlight branch.
  useEffect(() => {
    if (!open || !existingHighlight) return
    setHighlightId(existingHighlight.id)
    setTitleText(existingHighlight.selectionText)
    setNote(existingHighlight.note ?? '')
    setTags(existingHighlight.presetTags)
    setExpanded(false)
    const cachedGloss = existingHighlight.fastGloss ? parseCachedGloss(existingHighlight.fastGloss) : null
    if (cachedGloss) {
      setGlossState({ kind: 'ready', ...cachedGloss, ipa: null })
    } else {
      setGlossState({ kind: 'loading' })
    }
    // Fetch even when a cached gloss exists so old highlight rows can be
    // enriched with Wiktionary IPA without changing the fast_gloss column.
    let cancelled = false
    void (async () => {
      try {
        const res = await fetchGloss({ sessionId, highlightId: existingHighlight.id })
        if (cancelled) return
        setGlossState({
          kind: 'ready',
          gloss: res.data.gloss,
          pos: res.data.pos,
          register: res.data.register,
          ipa: res.data.ipa,
        })
      } catch {
        if (!cancelled && !cachedGloss) setGlossState({ kind: 'error' })
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
    setGlossState({ kind: 'loading' })

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
          const cachedGloss = match.fastGloss ? parseCachedGloss(match.fastGloss) : null
          if (cachedGloss) setGlossState({ kind: 'ready', ...cachedGloss, ipa: null })
          try {
            const res = await fetchGloss({ sessionId, highlightId: match.id })
            if (cancelled) return
            setGlossState({
              kind: 'ready',
              gloss: res.data.gloss,
              pos: res.data.pos,
              register: res.data.register,
              ipa: res.data.ipa,
            })
          } catch {
            if (!cancelled && !cachedGloss) setGlossState({ kind: 'error' })
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
            kind: 'ready',
            gloss: res.data.gloss,
            pos: res.data.pos,
            register: res.data.register,
            ipa: res.data.ipa,
          })
        }
      } catch {
        if (!cancelled) setGlossState({ kind: 'error' })
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
    if (!selection || highlightId) return
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
      })
      setHighlightId(created.data.id)
    } catch {
      // The mutation's meta.errorMessage surfaces a toast; stay in preview mode.
    } finally {
      setIsSaving(false)
    }
  }, [selection, highlightId, createHighlight, sessionId])

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
      setGlossState({ kind: 'loading' })
      const gloss = await fetchGloss({ sessionId, highlightId: newId })
      setGlossState({
        kind: 'ready',
        gloss: gloss.data.gloss,
        pos: gloss.data.pos,
        register: gloss.data.register,
        ipa: gloss.data.ipa,
      })
    } catch {
      setGlossState({ kind: 'error' })
    }
  }

  // Hoisted so the lingui message uses a plain ${placeholder}, not a member access.
  const suggestedSurface = suggestedGhost?.surfaceForm ?? ''

  const handleRemove = () => {
    if (!highlightId) return
    deleteHighlight(
      { sessionId, highlightId },
      {
        onSuccess: () => {
          onClose()
        },
      }
    )
  }

  // Compose the localized chat question: each selected preset's sentence (in
  // gloss-sheet button order) followed by the verbatim note. Null when there is
  // nothing to ask, which suppresses the seed_card_chat job server-side.
  const composeChatSeedPrompt = (): string | null => {
    const selectedPrompts = PRESET_TAGS.filter((tag) => tags.includes(tag)).map((tag) => presetPrompts[tag])
    const trimmedNote = note.trim()
    const parts = trimmedNote ? [...selectedPrompts, trimmedNote] : selectedPrompts
    return parts.length ? parts.join('\n') : null
  }

  const handleSaveNote = () => {
    if (!highlightId) return
    saveNoteAndTags(
      { sessionId, highlightId, note: note.trim() || null, presetTags: tags, chatSeedPrompt: composeChatSeedPrompt() },
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

  const isReady = glossState.kind === 'ready'
  // Preview mode = a fresh, unsaved selection. The gloss is a free, ephemeral
  // lookup; nothing is persisted until the user clicks Save. Saved mode (an
  // existing highlight or a just-saved selection) keeps the Remove/note actions.
  const isPreview = !!selection && !existingHighlight && !highlightId
  const hasNoteDetails = note.trim().length > 0 || tags.length > 0

  // Right-click while previewing saves — the explicit power-shortcut that
  // mirrors the extension's right-click-to-save. The sheet is only open in
  // preview mode because a word/chunk is selected, so a right-click is "save
  // this".
  //
  // We act on the right-button `pointerdown`, NOT `contextmenu`: the floating
  // sheet (Radix) dismisses on an outside `pointerdown` (capture phase), which
  // flips `open` to false and tears this listener down BEFORE `contextmenu`
  // ever fires. Handling pointerdown runs the save within that same dispatch.
  // The save (createHighlight) and its success toast are driven by the global
  // mutation cache, so they complete even though the sheet then closes.
  useEffect(() => {
    if (!open || !isPreview) return
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 2) return
      e.preventDefault()
      void handleSave()
    }
    document.addEventListener('pointerdown', onPointerDown, { capture: true })
    return () => document.removeEventListener('pointerdown', onPointerDown, { capture: true })
  }, [open, isPreview, handleSave])
  const englishIpaDialect = userPrefs?.englishIpaDialect ?? 'ga'
  const displayedIpa = isReady
    ? (pickIpa((glossState as Extract<GlossState, { kind: 'ready' }>).ipa, targetLanguage, englishIpaDialect) ?? null)
    : null
  const hasWiktionaryData = KAIKKI_LANGUAGES.has(targetLanguage)
  const ipaLabel = isReady ? (displayedIpa ?? (hasWiktionaryData ? t`No Wiktionary IPA` : null)) : null
  const showIpaFlag = !!displayedIpa && targetLanguage === 'en'

  // Description fallback for accessibility — the title is the selection text,
  // which doesn't describe the sheet's purpose.
  const ariaDescription = useMemo(() => {
    if (isReady) return (glossState as Extract<GlossState, { kind: 'ready' }>).gloss
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
              {glossState.kind === 'loading' ? (
                <>
                  <Skeleton className='h-5 w-20' />
                  <Skeleton className='h-4 w-11/12' />
                  <Skeleton className='h-4 w-3/4' />
                  <div className='mt-1 flex flex-wrap gap-1.5'>
                    <Skeleton className='h-5 w-12 rounded-md' />
                    <Skeleton className='h-5 w-16 rounded-md' />
                  </div>
                  <p className='sr-only'>{ariaDescription}</p>
                </>
              ) : (
                <>
                  {ipaLabel && (
                    <p className='text-muted-foreground flex items-center gap-1.5 text-base leading-snug font-medium'>
                      {showIpaFlag && (
                        <EnglishIpaDialectFlag targetLanguage={targetLanguage} englishIpaDialect={englishIpaDialect} />
                      )}
                      <span>{ipaLabel}</span>
                    </p>
                  )}
                  {isReady ? (
                    <p className='text-muted-foreground text-sm'>
                      {(glossState as Extract<GlossState, { kind: 'ready' }>).gloss}
                    </p>
                  ) : (
                    <p className='sr-only'>{ariaDescription}</p>
                  )}
                  {isReady &&
                    ((glossState as Extract<GlossState, { kind: 'ready' }>).pos ||
                      (glossState as Extract<GlossState, { kind: 'ready' }>).register) && (
                      <div className='mt-1 flex flex-wrap gap-1.5'>
                        {(glossState as Extract<GlossState, { kind: 'ready' }>).pos && (
                          <Badge variant='outline'>{(glossState as Extract<GlossState, { kind: 'ready' }>).pos}</Badge>
                        )}
                        {(glossState as Extract<GlossState, { kind: 'ready' }>).register && (
                          <Badge variant='secondary'>
                            {(glossState as Extract<GlossState, { kind: 'ready' }>).register}
                          </Badge>
                        )}
                      </div>
                    )}
                </>
              )}
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

        {suggestedGhost && !adopted && highlightId && (
          <FloatingSheetBody>
            {/* Label sits above the button; the button itself stays understated. Still
                full-width so it's an easy tap target on mobile. */}
            <p className='text-muted-foreground mb-1.5 text-xs font-medium'>{t`Use suggested`}</p>
            <Button
              type='button'
              variant='outline'
              className='w-full justify-center'
              disabled={!highlightId || isSwitching}
              onClick={() => void handleUseSuggested()}
            >
              {isSwitching ? t`Switching…` : suggestedSurface}
            </Button>
          </FloatingSheetBody>
        )}

        {glossState.kind === 'error' && (
          <FloatingSheetBody>
            <p className='text-destructive'>
              {isPreview ? t`Could not fetch a gloss.` : t`Could not fetch a gloss. The highlight is still saved.`}
            </p>
          </FloatingSheetBody>
        )}

        <FloatingSheetExpanded>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t`Optional note for the LLM (what specifically confuses you?)`}
            rows={3}
          />
          <div className='flex flex-wrap gap-2'>
            {PRESET_TAGS.map((tag) => (
              <button
                key={tag}
                type='button'
                onClick={() => toggleTag(tag)}
                className={
                  tags.includes(tag)
                    ? 'rounded-full border border-yellow-400 bg-yellow-100 px-3 py-1 text-xs'
                    : 'rounded-full border px-3 py-1 text-xs hover:bg-gray-50'
                }
              >
                {presetLabels[tag]}
              </button>
            ))}
          </div>
          <p className='text-muted-foreground mt-2 text-xs'>{t`Your answer will appear in this card's chat.`}</p>
        </FloatingSheetExpanded>

        <FloatingSheetFooter>
          <div className='flex items-center justify-between gap-2'>
            {isPreview ? (
              // Preview mode: looking is free. Closing discards with nothing
              // saved; Save is the explicit action that persists the highlight
              // and fires the enrich/card job.
              <>
                <Button type='button' variant='ghost' size='sm' onClick={onClose}>
                  {t`Cancel`}
                </Button>
                <Button type='button' size='sm' disabled={isSaving} onClick={() => void handleSave()}>
                  <Save className='mr-1 h-4 w-4' />
                  {isSaving ? t`Saving…` : t`Save`}
                </Button>
              </>
            ) : (
              <>
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  disabled={isDeleting || !highlightId}
                  onClick={handleRemove}
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

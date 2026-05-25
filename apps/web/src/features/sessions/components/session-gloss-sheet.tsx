import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import { ChevronDown, ChevronUp, PencilLine, Trash2 } from 'lucide-react'
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

  const [glossState, setGlossState] = useState<GlossState>({ kind: 'idle' })
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [titleText, setTitleText] = useState<string>('')
  const [note, setNote] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [expanded, setExpanded] = useState(false)
  // Set once a ghost has been adopted in this open session, to hide the action.
  const [adopted, setAdopted] = useState(false)

  useLayoutEffect(() => {
    if (!open) return
    setExpanded(false)
    setAdopted(false)

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

  // Seed from a fresh selection: dedupe against the cache, otherwise create.
  useEffect(() => {
    if (!open || !selection || existingHighlight) return
    let cancelled = false
    setTitleText(selection.selectionText)
    setNote('')
    setTags([])
    setExpanded(false)
    setGlossState({ kind: 'loading' })
    void (async () => {
      try {
        const cached = queryClient.getQueryData(orpcQuery.highlights.listBySession.key({ input: { sessionId } })) as
          | { data: CachedHighlight[] }
          | undefined
        const match = findCachedHighlight(cached?.data, selection)
        let id: string
        if (match) {
          id = match.id
          setNote(match.note ?? '')
          setTags(match.presetTags ?? [])
          if (match.fastGloss) {
            if (cancelled) return
            setHighlightId(id)
            setGlossState({ kind: 'ready', ...parseCachedGloss(match.fastGloss), ipa: null })
          }
        } else {
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
          if (cancelled) return
          id = created.data.id
        }
        if (cancelled) return
        setHighlightId(id)
        const res = await fetchGloss({ sessionId, highlightId: id })
        if (cancelled) return
        setGlossState({
          kind: 'ready',
          gloss: res.data.gloss,
          pos: res.data.pos,
          register: res.data.register,
          ipa: res.data.ipa,
        })
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
    existingHighlight,
    sessionId,
    createHighlight,
    fetchGloss,
    queryClient,
  ])

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

  const handleSaveNote = () => {
    if (!highlightId) return
    saveNoteAndTags(
      { sessionId, highlightId, note: note.trim() || null, presetTags: tags },
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
  const hasNoteDetails = note.trim().length > 0 || tags.length > 0
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
          </div>
        </FloatingSheetHeader>

        {suggestedGhost && !adopted && (
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
            <p className='text-destructive'>{t`Could not fetch a gloss. The highlight is still saved.`}</p>
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
        </FloatingSheetExpanded>

        <FloatingSheetFooter>
          <div className='flex items-center justify-between gap-2'>
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
          </div>
        </FloatingSheetFooter>
      </FloatingSheetContent>
    </FloatingSheet>
  )
}

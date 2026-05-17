import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { orpcQuery } from '@/lib/transport/orpc-client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  useUpdateHighlightNoteAndTags,
} from '../api/sessions-hooks'
import type { SelectionResult } from '../hooks/use-text-selection'

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
  | { kind: 'ready'; gloss: string; pos: string | null; register: string | null }
  | { kind: 'error' }

interface SessionGlossSheetProps {
  open: boolean
  sessionId: string
  // Provide exactly one when `open=true`. `selection` is a fresh mouseup/touchend
  // result (the sheet creates the highlight). `existingHighlight` is a click on
  // an already-saved highlight span (the sheet reads cached metadata).
  selection: SelectionResult | null
  existingHighlight: ExistingHighlightInput | null
  anchor: FloatingSheetAnchor
  onClose: () => void
}

// Decodes the serialized fast_gloss column (gloss\n[POS]\n[register]) into the
// same shape the GlossPass endpoint returns.
const parseCachedGloss = (raw: string): { gloss: string; pos: string | null; register: string | null } => {
  const lines = raw.split(/\r?\n/)
  return {
    gloss: lines[0] ?? '',
    pos: lines[1]?.trim() || null,
    register: lines[2]?.trim() || null,
  }
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
  selection,
  existingHighlight,
  anchor,
  onClose,
}: SessionGlossSheetProps) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()

  const { mutateAsync: createHighlight } = useCreateHighlight(sessionId)
  const { mutateAsync: fetchGloss } = useFastGloss()
  const { mutate: deleteHighlight, isPending: isDeleting } = useDeleteHighlight(sessionId)
  const { mutate: saveNoteAndTags, isPending: isSavingNote } = useUpdateHighlightNoteAndTags(sessionId)

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

  // Reset transient state every time the sheet closes — the next open should
  // start fresh regardless of which target it's pointed at.
  useEffect(() => {
    if (!open) {
      setGlossState({ kind: 'idle' })
      setHighlightId(null)
      setNote('')
      setTags([])
      setExpanded(false)
      setTitleText('')
    }
  }, [open])

  // Seed from the existing-highlight branch.
  useEffect(() => {
    if (!open || !existingHighlight) return
    setHighlightId(existingHighlight.id)
    setTitleText(existingHighlight.selectionText)
    setNote(existingHighlight.note ?? '')
    setTags(existingHighlight.presetTags)
    if (existingHighlight.fastGloss) {
      setGlossState({ kind: 'ready', ...parseCachedGloss(existingHighlight.fastGloss) })
      return
    }
    // No cached gloss yet — fetch one. The endpoint also persists it.
    let cancelled = false
    setGlossState({ kind: 'loading' })
    void (async () => {
      try {
        const res = await fetchGloss({ sessionId, highlightId: existingHighlight.id })
        if (cancelled) return
        setGlossState({ kind: 'ready', gloss: res.data.gloss, pos: res.data.pos, register: res.data.register })
      } catch {
        if (!cancelled) setGlossState({ kind: 'error' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, existingHighlight?.id, sessionId, fetchGloss])

  // Seed from a fresh selection: dedupe against the cache, otherwise create.
  useEffect(() => {
    if (!open || !selection || existingHighlight) return
    let cancelled = false
    setTitleText(selection.selectionText)
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
            setGlossState({ kind: 'ready', ...parseCachedGloss(match.fastGloss) })
            return
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
        setGlossState({ kind: 'ready', gloss: res.data.gloss, pos: res.data.pos, register: res.data.register })
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
    >
      <FloatingSheetContent>
        <FloatingSheetHeader>
          <div className='flex items-start justify-between gap-2'>
            <div className='flex min-w-0 flex-col gap-1'>
              <FloatingSheetTitle className='truncate'>{titleText || t`Quick gloss`}</FloatingSheetTitle>
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

        {glossState.kind !== 'ready' && (
          <FloatingSheetBody>
            {glossState.kind === 'loading' && <p className='text-muted-foreground'>{t`Glossing…`}</p>}
            {glossState.kind === 'error' && (
              <p className='text-destructive'>{t`Could not fetch a gloss. The highlight is still saved.`}</p>
            )}
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
            {expanded && (
              <Button type='button' size='sm' disabled={isSavingNote || !highlightId} onClick={handleSaveNote}>
                {isSavingNote ? t`Saving…` : t`Save note`}
              </Button>
            )}
          </div>
        </FloatingSheetFooter>
      </FloatingSheetContent>
    </FloatingSheet>
  )
}

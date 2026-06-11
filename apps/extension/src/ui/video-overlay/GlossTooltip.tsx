import { useCallback, useEffect, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { computePosition, flip, shift, offset, autoUpdate } from '@floating-ui/dom'
import { ChevronDown, ChevronRight, PencilLine, Save, Trash2 } from 'lucide-react'
import {
  defaultStudyIntentDraft,
  draftToStudyIntent,
  type StudyIntentDraft,
  type StudyIntentValue,
} from '@flicktionary/ui/components/study-options-section'
import { GlossCardBody } from '@flicktionary/ui/components/gloss-card-body'
import { Button } from '@flicktionary/ui/components/button'
import { Textarea } from '@flicktionary/ui/components/textarea'
import type { SavedHighlightDto } from '@asbplayer-fork/common'
import {
  GlossData,
  deleteSavedHighlight,
  fetchSavedGloss,
  pickIpa,
  updateSavedHighlightNote,
} from '../../services/flicktionary/flicktionary-client'
import { parseFastGloss } from './parse-fast-gloss'

export type GlossContent =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: GlossData }

// Both popovers hardcode the web app's DARK theme: they always float over
// video, where the light card would glare. The `dark` class on the root makes
// the shared tokens (tokens.css `.dark { … }`, adopted into the popover shadow
// root) and every `dark:` variant in the shared components resolve — so the
// card looks exactly like the web gloss sheet in dark mode.
const POPOVER_CARD_CLASS =
  'dark pointer-events-auto fixed left-0 top-0 z-[2147483647] flex w-80 max-w-[90vw] flex-col rounded-md border bg-popover text-popover-foreground shadow-xl px-2 py-0'

// Web FloatingSheet section paddings (header/body/footer), so the composed
// card matches the web sheet's rhythm.
const CARD_HEADER_CLASS = 'flex flex-col gap-1 px-2 pt-3 pb-2'
const CARD_BODY_CLASS = 'flex flex-col gap-2 px-2 pb-2 text-sm'
const CARD_FOOTER_CLASS = 'mt-auto flex flex-col gap-2 px-2 pt-2 pb-3'

// Floating-ui positioning shared by the preview and saved popovers: fixed
// strategy against the anchor's viewport rect (the anchor lives in the
// transformed subtitle shadow tree, the popover in the separate non-transformed
// popover host — correct in both windowed and fullscreen). Returns the
// `positioned` gate that hides the first unpositioned paint.
const useTooltipPosition = (anchor: HTMLElement, ref: React.RefObject<HTMLDivElement | null>) => {
  const [positioned, setPositioned] = useState(false)
  useEffect(() => {
    const tooltip = ref.current
    if (!tooltip) return

    setPositioned(false)
    const update = () => {
      computePosition(anchor, tooltip, {
        strategy: 'fixed',
        placement: 'top',
        middleware: [offset(8), flip({ fallbackPlacements: ['bottom', 'top'] }), shift({ padding: 5 })],
      }).then(({ x, y }) => {
        tooltip.style.left = `${x}px`
        tooltip.style.top = `${y}px`
        setPositioned(true)
      })
    }

    return autoUpdate(anchor, tooltip, update)
  }, [anchor, ref])
  return positioned
}

// The gloss body, shared by the preview and saved modes: the web app's
// GlossCardBody (IPA + gloss + POS/register badges + loading skeletons) plus
// the extension-only empty/error rows GlossCardBody doesn't model.
const GlossBody = ({ content, srDescription }: { content: GlossContent; srDescription: string }) => (
  <>
    <GlossCardBody
      loading={content.status === 'loading'}
      gloss={content.status === 'ready' ? content.data.gloss || null : null}
      pos={content.status === 'ready' ? content.data.pos : null}
      register={content.status === 'ready' ? content.data.register : null}
      ipaLabel={content.status === 'ready' ? pickIpa(content.data.ipa) : null}
      srDescription={srDescription}
    />
    {content.status === 'ready' && !content.data.gloss && (
      <p className='text-muted-foreground text-sm'>
        <Trans>No translation available</Trans>
      </p>
    )}
    {content.status === 'error' && <p className='text-destructive text-sm'>{content.message}</p>}
  </>
)

export interface GlossTooltipProps {
  // The word span to anchor against. Lives in the (transformed) subtitle shadow
  // tree, but THIS tooltip is portaled into the separate, non-transformed
  // popover shadow host — so floating-ui's `strategy: 'fixed'` against the
  // anchor's viewport rect is correct in both windowed and fullscreen.
  anchor: HTMLElement
  word: string
  content: GlossContent
  // Explicit save (mirrors the right-click power-shortcut): persists the
  // highlighted word. Looking via hover stays free. `studyIntent` carries any
  // touched "Study options" draft (undefined = backend default); the
  // right-click shortcut bypasses the tooltip and always saves with the
  // default.
  onSave: (studyIntent?: StudyIntentValue) => void
  // When set, saving is unavailable here (e.g. off YouTube, where saving isn't
  // wired up yet). Render Save disabled with this reason instead of an active
  // button — looking is still free, so the gloss above stays fully usable.
  saveDisabledReason?: string | null
  // Whether the user is paired ("signed in") with Flicktionary. When false,
  // glossing and saving both fail, so we surface a Sign in button in place of
  // Save (the gloss area already shows the "Sign in to translate" message).
  signedIn: boolean
  // Start the pairing flow (mirrors the popup's "Sign in with Flicktionary").
  onSignIn: () => void
  // A save kicked off from this popover is in flight — Save renders disabled
  // as "Saving…" until the outcome swaps the popover into saved mode.
  saving?: boolean
  // Hover bridge: the pointer entering/leaving the popover. Entering cancels
  // the pending hide AND pins the popover (it stops hiding on pointer-leave —
  // see glossPinnedRef in SubtitleOverlayApp); before that, leaving dismisses.
  onPointerEnter: () => void
  onPointerLeave: () => void
  // Outside pointerdown — the parent dismisses a PINNED popover on it (same
  // gesture as the saved-mode popover) and ignores it while unpinned.
  onOutsidePointerDown: () => void
}

// Hover gloss popover — mirrors the web app's fast-gloss popover. Positioned
// with @floating-ui/dom (fixed strategy, top placement, flip + shift), kept in
// sync via autoUpdate. No `display` toggling: React mounts/unmounts it, so the
// legacy `display:flex !important` hide trap is gone.
export function GlossTooltip({
  anchor,
  word,
  content,
  onSave,
  onPointerEnter,
  onPointerLeave,
  onOutsidePointerDown,
  saveDisabledReason,
  signedIn,
  onSignIn,
  saving,
}: GlossTooltipProps) {
  const { t } = useLingui()
  const ref = useRef<HTMLDivElement>(null)
  // Gate visibility until the async computePosition has placed the tooltip;
  // otherwise it paints one frame at its initial top-left before moving (the
  // brief viewport-corner flash). Reset whenever the anchor changes.
  const positioned = useTooltipPosition(anchor, ref)
  // "Study options" draft (full-set semantics — see the shared component's
  // model in @flicktionary/ui). Only the MODEL is shared: the controls below
  // are native px-sized inputs because Radix Checkbox/Switch rem-size against
  // the HOST page root font-size inside shadow surfaces (EXTENSION-SPEC.md).
  const [studyDraft, setStudyDraft] = useState<StudyIntentDraft>(defaultStudyIntentDraft)
  const [optionsExpanded, setOptionsExpanded] = useState(false)

  // A new word = a new save target: re-collapse and re-arm the draft.
  useEffect(() => {
    setStudyDraft(defaultStudyIntentDraft)
    setOptionsExpanded(false)
  }, [word])

  // Outside pointerdown → onOutsidePointerDown (the parent only acts on it
  // while pinned). composedPath (not target containment) because the popover
  // lives inside a shadow root — same dismissal as SavedGlossTooltip.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const el = ref.current
      if (el && e.composedPath().includes(el)) return
      onOutsidePointerDown()
    }
    document.addEventListener('pointerdown', onPointerDown, { capture: true })
    return () => document.removeEventListener('pointerdown', onPointerDown, { capture: true })
  }, [onOutsidePointerDown])

  return (
    <div
      ref={ref}
      data-flicktionary-gloss-popover=''
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
      style={{ visibility: positioned ? 'visible' : 'hidden' }}
      className={POPOVER_CARD_CLASS}
    >
      <div className={CARD_HEADER_CLASS}>
        <div className='text-foreground text-base font-semibold break-words'>{word}</div>
        <GlossBody content={content} srDescription={t`Translation and save action for the hovered word.`} />
      </div>

      {/* Study options — only when saving is actually available. Native
          checkbox inputs (px-sized; see the draft-state comment above), but
          the disclosure/row styling mirrors the web StudyOptionsSection. */}
      {signedIn && !saveDisabledReason && (
        <div className={CARD_BODY_CLASS}>
          <button
            type='button'
            onClick={() => setOptionsExpanded((prev) => !prev)}
            aria-expanded={optionsExpanded}
            className='text-muted-foreground hover:text-foreground flex items-center gap-1 self-start text-xs font-medium transition-colors'
          >
            {optionsExpanded ? <ChevronDown className='h-3.5 w-3.5' /> : <ChevronRight className='h-3.5 w-3.5' />}
            <Trans>Study options</Trans>
          </button>
          {optionsExpanded &&
            (() => {
              const checkedSkillCount = [
                studyDraft.recognition,
                studyDraft.production,
                studyDraft.pronunciation,
              ].filter(Boolean).length
              const isLastCheckedSkill = (checked: boolean) => checked && checkedSkillCount === 1
              const hasMeaningSkill = studyDraft.recognition || studyDraft.production
              const patch = (partial: Partial<StudyIntentDraft>) =>
                setStudyDraft((prev) => ({ ...prev, ...partial, touched: true }))
              const rowClass = (rowDisabled: boolean) =>
                `flex items-center gap-2 text-sm ${rowDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`
              const boxClass = 'size-4 accent-primary'
              return (
                <div className='flex flex-col gap-2'>
                  <label className={rowClass(isLastCheckedSkill(studyDraft.recognition))}>
                    <input
                      type='checkbox'
                      className={boxClass}
                      checked={studyDraft.recognition}
                      disabled={isLastCheckedSkill(studyDraft.recognition)}
                      onChange={(e) => patch({ recognition: e.target.checked })}
                    />
                    <Trans>Recognition</Trans>
                  </label>
                  <label className={rowClass(isLastCheckedSkill(studyDraft.production))}>
                    <input
                      type='checkbox'
                      className={boxClass}
                      checked={studyDraft.production}
                      disabled={isLastCheckedSkill(studyDraft.production)}
                      onChange={(e) => patch({ production: e.target.checked })}
                    />
                    <Trans>Production</Trans>
                  </label>
                  {/* Always offerable: the preview's IPA is a Wiktionary-only
                      lookup, but enrichment generates IPA for every saved
                      selection — a pronunciation facet just stays pending
                      until the generated IPA lands. */}
                  <label className={rowClass(isLastCheckedSkill(studyDraft.pronunciation))}>
                    <input
                      type='checkbox'
                      className={boxClass}
                      checked={studyDraft.pronunciation}
                      disabled={isLastCheckedSkill(studyDraft.pronunciation)}
                      onChange={(e) => patch({ pronunciation: e.target.checked })}
                    />
                    <Trans>Pronunciation</Trans>
                  </label>
                  <label className={rowClass(!hasMeaningSkill)}>
                    <input
                      type='checkbox'
                      className={boxClass}
                      checked={studyDraft.exactForm}
                      disabled={!hasMeaningSkill}
                      onChange={(e) => patch({ exactForm: e.target.checked })}
                    />
                    <span className='min-w-0 break-words'>
                      <Trans>Study this exact form</Trans>{' '}
                      <span className='text-muted-foreground'>(&ldquo;{word}&rdquo;)</span>
                    </span>
                  </label>
                </div>
              )
            })()}
        </div>
      )}

      {/* Not signed in → both glossing and saving fail, so offer Sign in in
          place of Save (the gloss area shows the "Sign in to translate" note).
          Otherwise the explicit Save — discoverable counterpart to the
          right-click shortcut, disabled (with a reason) where unavailable. */}
      <div className={CARD_FOOTER_CLASS}>
        {!signedIn ? (
          <Button type='button' size='xl' className='w-full' onClick={onSignIn}>
            <Trans>Sign in</Trans>
          </Button>
        ) : saveDisabledReason ? (
          <>
            <Button type='button' size='xl' className='w-full' disabled>
              <Save className='mr-1 h-4 w-4' />
              <Trans>Save</Trans>
            </Button>
            <div className='text-muted-foreground text-xs'>{saveDisabledReason}</div>
          </>
        ) : (
          <Button
            type='button'
            size='xl'
            className='w-full'
            disabled={saving}
            onClick={() => onSave(draftToStudyIntent(studyDraft))}
          >
            <Save className='mr-1 h-4 w-4' />
            {saving ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
          </Button>
        )}
      </div>
    </div>
  )
}

// Preset tags offered in the saved-mode note editor — same ids as the web
// gloss sheet, so a note edited here reads identically in the web app.
const PRESET_TAGS = ['explain', '3_examples', 'synonyms', 'etymology', 'why_this_form'] as const
type PresetTag = (typeof PRESET_TAGS)[number]

export interface SavedGlossTooltipProps {
  anchor: HTMLElement
  sessionId: string
  highlight: SavedHighlightDto
  // The delete landed (or the row was already gone) — the caller removes the
  // span from the store and closes the popover.
  onRemoved: () => void
  // The note/tags write landed — the caller patches the store entry so a
  // re-open shows the saved values without a reload.
  onNotePatched: (note: string | null, presetTags: string[]) => void
  onClose: () => void
}

// Saved-mode popover for a click on an already-saved span — parity with the
// web session view's gloss sheet minus ghost-extend: cached gloss instantly
// (refreshed via highlights.fastGloss), Remove highlight, and the note + preset
// tags editor that seeds the card chat. Unlike the hover preview it is STICKY:
// it has a textarea, so it dismisses on outside pointerdown (composedPath —
// the popover lives in its own shadow root) / play / cue change, never on
// pointer-leave. No Study options / Save here — the word is already saved.
export function SavedGlossTooltip({
  anchor,
  sessionId,
  highlight,
  onRemoved,
  onNotePatched,
  onClose,
}: SavedGlossTooltipProps) {
  const { t } = useLingui()
  const ref = useRef<HTMLDivElement>(null)
  const positioned = useTooltipPosition(anchor, ref)

  const [content, setContent] = useState<GlossContent>(() =>
    highlight.fastGloss
      ? { status: 'ready', data: { ...parseFastGloss(highlight.fastGloss), ipa: null } }
      : { status: 'loading' }
  )
  const [note, setNote] = useState(highlight.note ?? '')
  const [tags, setTags] = useState<string[]>([...highlight.presetTags])
  const [noteExpanded, setNoteExpanded] = useState(false)
  const [busy, setBusy] = useState<'remove' | 'note' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const presetLabels: Record<PresetTag, string> = {
    explain: t`Explain`,
    '3_examples': t`3 examples`,
    synonyms: t`Synonyms`,
    etymology: t`Etymology`,
    why_this_form: t`Why this form?`,
  }

  // Localized natural-language phrasing for each preset, composed into the chat
  // question sent to the backend — same contract as the web gloss sheet's
  // composeChatSeedPrompt (localize client-side, backend stays language-agnostic).
  const presetPrompts: Record<PresetTag, string> = {
    explain: t`Explain this term in more depth.`,
    '3_examples': t`Give me three more example sentences using it.`,
    synonyms: t`What are some synonyms or near-synonyms, and how do they differ?`,
    etymology: t`What's the etymology or origin of this term?`,
    why_this_form: t`Why does it appear in this particular form here?`,
  }

  // Refresh the gloss from the server even when a cached fastGloss rendered
  // instantly — this also enriches older rows with Wiktionary IPA.
  useEffect(() => {
    let cancelled = false
    void fetchSavedGloss(sessionId, highlight.id).then((data) => {
      if (cancelled || !data) return
      setContent({ status: 'ready', data })
    })
    return () => {
      cancelled = true
    }
  }, [sessionId, highlight.id])

  // Sticky dismissal: outside pointerdown closes. composedPath (not target
  // containment) because the popover lives inside a shadow root.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const el = ref.current
      if (el && e.composedPath().includes(el)) return
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown, { capture: true })
    return () => document.removeEventListener('pointerdown', onPointerDown, { capture: true })
  }, [onClose])

  const handleRemove = useCallback(() => {
    setBusy('remove')
    setActionError(null)
    void deleteSavedHighlight(sessionId, highlight.id).then((ok) => {
      setBusy(null)
      if (ok) onRemoved()
      else setActionError(t`Could not remove the highlight.`)
    })
  }, [sessionId, highlight.id, onRemoved, t])

  const handleSaveNote = useCallback(() => {
    const trimmedNote = note.trim()
    const selectedPrompts = PRESET_TAGS.filter((tag) => tags.includes(tag)).map((tag) => presetPrompts[tag])
    const parts = trimmedNote ? [...selectedPrompts, trimmedNote] : selectedPrompts
    const chatSeedPrompt = parts.length ? parts.join('\n') : null
    setBusy('note')
    setActionError(null)
    void updateSavedHighlightNote({
      sessionId,
      highlightId: highlight.id,
      note: trimmedNote || null,
      presetTags: tags,
      chatSeedPrompt,
    }).then((ok) => {
      setBusy(null)
      if (ok) {
        onNotePatched(trimmedNote || null, tags)
        setNoteExpanded(false)
      } else {
        setActionError(t`Could not save the note.`)
      }
    })
    // presetPrompts is a per-render literal of stable translations — not a dep.
  }, [sessionId, highlight.id, note, tags, onNotePatched, t])

  const toggleTag = (tag: PresetTag) => {
    setTags((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]))
  }

  const hasNoteDetails = (highlight.note ?? '').trim().length > 0 || highlight.presetTags.length > 0

  return (
    <div
      ref={ref}
      data-flicktionary-saved-popover=''
      style={{ visibility: positioned ? 'visible' : 'hidden' }}
      className={POPOVER_CARD_CLASS}
    >
      <div className={CARD_HEADER_CLASS}>
        <div className='text-foreground text-base font-semibold break-words'>{highlight.selectionText}</div>
        <GlossBody content={content} srDescription={t`Translation and actions for the saved highlight.`} />
        {actionError && <p className='text-destructive text-sm'>{actionError}</p>}
      </div>

      {noteExpanded && (
        <div className={CARD_BODY_CLASS}>
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
                    ? 'rounded-full border border-yellow-400 bg-yellow-100 px-3 py-1 text-xs dark:bg-yellow-400/15'
                    : 'hover:bg-accent rounded-full border px-3 py-1 text-xs'
                }
              >
                {presetLabels[tag]}
              </button>
            ))}
          </div>
          <p className='text-muted-foreground mt-2 text-xs'>
            <Trans>Your answer will appear in this card's chat.</Trans>
          </p>
        </div>
      )}

      <div className={CARD_FOOTER_CLASS}>
        <div className='flex items-center justify-between gap-2'>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            disabled={busy !== null}
            onClick={handleRemove}
            className='text-destructive hover:bg-destructive/10'
          >
            <Trash2 className='mr-1 h-4 w-4' />
            {busy === 'remove' ? <Trans>Removing…</Trans> : <Trans>Remove highlight</Trans>}
          </Button>
          {noteExpanded ? (
            <Button type='button' size='sm' disabled={busy !== null} onClick={handleSaveNote}>
              {busy === 'note' ? <Trans>Saving…</Trans> : <Trans>Save note</Trans>}
            </Button>
          ) : (
            <Button type='button' variant='outline' size='sm' onClick={() => setNoteExpanded(true)}>
              <PencilLine className='h-4 w-4' />
              {hasNoteDetails ? <Trans>Edit note</Trans> : <Trans>Add note</Trans>}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

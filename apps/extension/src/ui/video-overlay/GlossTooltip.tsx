import { useCallback, useEffect, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { computePosition, flip, shift, offset, autoUpdate } from '@floating-ui/dom'
import { PencilLine, Save, Trash2 } from 'lucide-react'
import {
  defaultStudyIntentDraft,
  draftToStudyIntent,
  StudyOptionsSection,
  type StudyIntentDraft,
  type StudyIntentValue,
} from '@flicktionary/ui/components/study-options-section'
import { GlossCardBody } from '@flicktionary/ui/components/gloss-card-body'
import { Button } from '@flicktionary/ui/components/button'
import { Textarea } from '@flicktionary/ui/components/textarea'
import {
  PRESET_TAGS,
  composeChatSeedPrompt,
  usePresetTagTexts,
  type PresetTag,
} from '@flicktionary/ui/components/preset-tags'
import { parseFastGloss } from '@flicktionary/core/utils/parse-fast-gloss'
import type { GlossViewState } from '@flicktionary/core/types/gloss-view-state'
import type { SavedHighlightDto } from '@asbplayer-fork/common'
import {
  deleteSavedHighlight,
  fetchSavedGloss,
  updateSavedHighlightNote,
} from '../../services/flicktionary/flicktionary-client'

// The shared gloss view state under this file's historical name — the overlay
// never constructs the web-only `idle` member.
export type GlossContent = GlossViewState

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
      gloss={content.status === 'ready' ? content.gloss || null : null}
      pos={content.status === 'ready' ? content.pos : null}
      register={content.status === 'ready' ? content.register : null}
      ipaLabel={content.status === 'ready' ? content.ipaDisplay : null}
      srDescription={srDescription}
    />
    {content.status === 'ready' && !content.gloss && (
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
  // "Study options" draft (full-set semantics). The SECTION is the shared web
  // component — safe in shadow surfaces since the ui Checkbox/Switch were
  // px-pinned at source (the rem-vs-host-root trap is fixed there, see the
  // Switch's track-height comment).
  const [studyDraft, setStudyDraft] = useState<StudyIntentDraft>(defaultStudyIntentDraft)

  // A new word = a new save target: re-arm the draft (the section re-collapses
  // via its `key={word}` remount).
  useEffect(() => {
    setStudyDraft(defaultStudyIntentDraft)
  }, [word])

  // Outside pointerdown → onOutsidePointerDown (the parent only acts on it
  // while pinned). composedPath (not target containment) because the popover
  // lives inside a shadow root — same dismissal as SavedGlossTooltip.
  // Right-button presses are NOT a dismiss intent: right-click is the
  // save/remove toggle, and an open popover survives it and morphs in place.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 2) return
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

      {/* Study options — only when saving is actually available. The shared
          web section (Radix Checkbox + Switch, px-pinned at source), so the
          controls are pixel-identical to the web sheet. */}
      {signedIn && !saveDisabledReason && (
        <div className={CARD_BODY_CLASS}>
          <StudyOptionsSection key={word} value={studyDraft} onChange={setStudyDraft} surfaceForm={word} />
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
  // The pointer entered the popover. A HOVER-opened popover (see
  // SavedPopoverState.hover) uses this to cancel its pending word-leave hide
  // and flip itself sticky; a click-opened one is sticky already.
  onPointerEnter?: () => void
}

// Saved-mode popover for a click OR hover on an already-saved span — parity
// with the web session view's gloss sheet minus ghost-extend: cached gloss
// instantly (refreshed via highlights.fastGloss), Remove highlight, and the
// note + preset tags editor that seeds the card chat. A click open is STICKY
// from the start: it has a textarea, so it dismisses on outside pointerdown
// (composedPath — the popover lives in its own shadow root) / play / cue
// change, never on pointer-leave. A hover open starts with the hover gloss's
// grace-timer dismissal and turns sticky once the pointer enters it (the
// parent's onPointerEnter wiring). No Study options / Save here — the word is
// already saved.
export function SavedGlossTooltip({
  anchor,
  sessionId,
  highlight,
  onRemoved,
  onNotePatched,
  onClose,
  onPointerEnter,
}: SavedGlossTooltipProps) {
  const { t } = useLingui()
  const ref = useRef<HTMLDivElement>(null)
  const positioned = useTooltipPosition(anchor, ref)

  const [content, setContent] = useState<GlossContent>(() =>
    highlight.fastGloss
      ? { status: 'ready', ...parseFastGloss(highlight.fastGloss), ipaDisplay: null }
      : { status: 'loading' }
  )
  const [note, setNote] = useState(highlight.note ?? '')
  const [tags, setTags] = useState<string[]>([...highlight.presetTags])
  const [noteExpanded, setNoteExpanded] = useState(false)
  const [busy, setBusy] = useState<'remove' | 'note' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const { labels: presetLabels, prompts: presetPrompts } = usePresetTagTexts()

  // Refresh the gloss from the server even when a cached fastGloss rendered
  // instantly — this also enriches older rows with Wiktionary IPA.
  useEffect(() => {
    let cancelled = false
    void fetchSavedGloss(sessionId, highlight.id).then((data) => {
      if (cancelled || !data) return
      setContent({ status: 'ready', ...data })
    })
    return () => {
      cancelled = true
    }
  }, [sessionId, highlight.id])

  // Sticky dismissal: outside pointerdown closes. composedPath (not target
  // containment) because the popover lives inside a shadow root. Right-button
  // presses are NOT a dismiss intent: right-click is the save/remove toggle —
  // a right-click remove swaps this popover into the preview gloss instead.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 2) return
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
    setBusy('note')
    setActionError(null)
    void updateSavedHighlightNote({
      sessionId,
      highlightId: highlight.id,
      note: trimmedNote || null,
      presetTags: tags,
      chatSeedPrompt: composeChatSeedPrompt(tags, presetPrompts, note),
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
      onMouseEnter={onPointerEnter}
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

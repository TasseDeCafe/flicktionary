import { useCallback, useEffect, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { computePosition, flip, shift, offset, autoUpdate } from '@floating-ui/dom'
import {
  defaultStudyIntentDraft,
  draftToStudyIntent,
  type StudyIntentDraft,
  type StudyIntentValue,
} from '@flicktionary/ui/components/study-options-section'
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

// The gloss body (spinner / error / ipa + gloss + pos/register chips), shared
// by the preview and saved modes so both render identically.
const GlossBody = ({ content }: { content: GlossContent }) => {
  const ipaLabel = content.status === 'ready' ? pickIpa(content.data.ipa) : null
  return (
    <>
      {content.status === 'loading' && (
        <div className='my-0.5 h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white' />
      )}

      {content.status === 'error' && <div className='text-[13px] text-[#ff9b9b]'>{content.message}</div>}

      {content.status === 'ready' && (
        <>
          {ipaLabel && <div className='text-[13px] text-white/70'>{ipaLabel}</div>}
          <div className='text-sm break-words whitespace-pre-wrap text-white/90'>
            {content.data.gloss || <Trans>No translation available</Trans>}
          </div>
          {(content.data.pos || content.data.register) && (
            <div className='mt-0.5 flex flex-wrap gap-1.5'>
              {content.data.pos && (
                <span className='inline-block rounded-full border border-white/35 px-2 text-[11px] font-semibold leading-normal text-white/90'>
                  {content.data.pos}
                </span>
              )}
              {content.data.register && (
                <span className='inline-block rounded-full border border-transparent bg-white/20 px-2 text-[11px] font-semibold leading-normal text-white/90'>
                  {content.data.register}
                </span>
              )}
            </div>
          )}
        </>
      )}
    </>
  )
}

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
  // Hover bridge: the pointer entering/leaving the popover. Entering cancels the
  // pending hide so the user can reach the Save button; leaving dismisses it.
  onPointerEnter: () => void
  onPointerLeave: () => void
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
  saveDisabledReason,
  signedIn,
  onSignIn,
}: GlossTooltipProps) {
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

  const ipaLabel = content.status === 'ready' ? pickIpa(content.data.ipa) : null

  return (
    <div
      ref={ref}
      data-flicktionary-gloss-popover=''
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
      style={{ visibility: positioned ? 'visible' : 'hidden' }}
      className='pointer-events-auto fixed left-0 top-0 z-[2147483647] flex max-w-[320px] flex-col gap-1 rounded-lg bg-black/90 px-3 py-2 text-sm leading-snug text-white shadow-[0_4px_16px_rgba(0,0,0,0.4)]'
    >
      <div className='text-[15px] font-semibold break-words text-white'>{word}</div>

      <GlossBody content={content} />

      {/* Study options — only when saving is actually available. Native
          checkbox inputs (px-sized; see the draft-state comment above). */}
      {signedIn && !saveDisabledReason && (
        <div className='mt-1 flex flex-col gap-1'>
          <button
            type='button'
            onClick={() => setOptionsExpanded((prev) => !prev)}
            aria-expanded={optionsExpanded}
            className='self-start text-[12px] font-medium text-white/60 transition-colors hover:text-white/90'
          >
            {optionsExpanded ? '▾ ' : '▸ '}
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
              const pronunciationAvailable = !!ipaLabel
              const patch = (partial: Partial<StudyIntentDraft>) =>
                setStudyDraft((prev) => ({ ...prev, ...partial, touched: true }))
              const rowClass = (rowDisabled: boolean) =>
                `flex items-center gap-1.5 text-[13px] ${rowDisabled ? 'cursor-not-allowed text-white/40' : 'cursor-pointer text-white/90'}`
              const boxClass = 'size-[13px] accent-white'
              return (
                <div className='flex flex-col gap-1'>
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
                  <label className={rowClass(isLastCheckedSkill(studyDraft.pronunciation) || !pronunciationAvailable)}>
                    <input
                      type='checkbox'
                      className={boxClass}
                      checked={studyDraft.pronunciation}
                      disabled={isLastCheckedSkill(studyDraft.pronunciation) || !pronunciationAvailable}
                      onChange={(e) => patch({ pronunciation: e.target.checked })}
                    />
                    <Trans>Pronunciation</Trans>
                    {!pronunciationAvailable && (
                      <span className='text-[11px] text-white/40'>
                        <Trans>Needs a known transcription</Trans>
                      </span>
                    )}
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
                      <Trans>Study this exact form</Trans> <span className='text-white/50'>(&ldquo;{word}&rdquo;)</span>
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
      {!signedIn ? (
        <button
          type='button'
          onClick={onSignIn}
          className='mt-1.5 self-start rounded-md bg-white/15 px-2.5 py-1 text-[13px] font-semibold text-white transition-colors hover:bg-white/25'
        >
          <Trans>Sign in</Trans>
        </button>
      ) : saveDisabledReason ? (
        <div className='mt-1.5 flex flex-col gap-1'>
          <button
            type='button'
            disabled
            className='self-start cursor-not-allowed rounded-md bg-white/10 px-2.5 py-1 text-[13px] font-semibold text-white/40'
          >
            <Trans>Save</Trans>
          </button>
          <div className='text-[12px] text-white/60'>{saveDisabledReason}</div>
        </div>
      ) : (
        <button
          type='button'
          onClick={() => onSave(draftToStudyIntent(studyDraft))}
          className='mt-1.5 self-start rounded-md bg-white/15 px-2.5 py-1 text-[13px] font-semibold text-white transition-colors hover:bg-white/25'
        >
          <Trans>Save</Trans>
        </button>
      )}
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
      className='pointer-events-auto fixed left-0 top-0 z-[2147483647] flex w-[320px] max-w-[90vw] flex-col gap-1 rounded-lg bg-black/90 px-3 py-2 text-sm leading-snug text-white shadow-[0_4px_16px_rgba(0,0,0,0.4)]'
    >
      <div className='text-[15px] font-semibold break-words text-white'>{highlight.selectionText}</div>

      <GlossBody content={content} />

      {actionError && <div className='text-[13px] text-[#ff9b9b]'>{actionError}</div>}

      {noteExpanded && (
        <div className='mt-1 flex flex-col gap-1.5'>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t`Optional note for the LLM (what specifically confuses you?)`}
            rows={3}
            className='w-full resize-none rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-[13px] text-white placeholder:text-white/40 focus:outline-none'
          />
          <div className='flex flex-wrap gap-1.5'>
            {PRESET_TAGS.map((tag) => (
              <button
                key={tag}
                type='button'
                onClick={() => toggleTag(tag)}
                className={
                  tags.includes(tag)
                    ? 'rounded-full border border-yellow-300/80 bg-yellow-300/20 px-2 py-0.5 text-[11px] text-white'
                    : 'rounded-full border border-white/25 px-2 py-0.5 text-[11px] text-white/80 transition-colors hover:bg-white/10'
                }
              >
                {presetLabels[tag]}
              </button>
            ))}
          </div>
          <p className='text-[11px] text-white/50'>
            <Trans>Your answer will appear in this card's chat.</Trans>
          </p>
        </div>
      )}

      <div className='mt-1.5 flex items-center justify-between gap-2'>
        <button
          type='button'
          disabled={busy !== null}
          onClick={handleRemove}
          className='rounded-md px-2 py-1 text-[13px] font-semibold text-[#ff9b9b] transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50'
        >
          {busy === 'remove' ? <Trans>Removing…</Trans> : <Trans>Remove highlight</Trans>}
        </button>
        {noteExpanded ? (
          <button
            type='button'
            disabled={busy !== null}
            onClick={handleSaveNote}
            className='rounded-md bg-white/15 px-2.5 py-1 text-[13px] font-semibold text-white transition-colors hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-50'
          >
            {busy === 'note' ? <Trans>Saving…</Trans> : <Trans>Save note</Trans>}
          </button>
        ) : (
          <button
            type='button'
            onClick={() => setNoteExpanded(true)}
            className='rounded-md bg-white/15 px-2.5 py-1 text-[13px] font-semibold text-white transition-colors hover:bg-white/25'
          >
            {hasNoteDetails ? <Trans>Edit note</Trans> : <Trans>Add note</Trans>}
          </button>
        )}
      </div>
    </div>
  )
}

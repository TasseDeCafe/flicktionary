import { useEffect, useRef, useState } from 'react'
import { Trans } from '@lingui/react/macro'
import { computePosition, flip, shift, offset, autoUpdate } from '@floating-ui/dom'
import {
  defaultStudyIntentDraft,
  draftToStudyIntent,
  type StudyIntentDraft,
  type StudyIntentValue,
} from '@flicktionary/ui/components/study-options-section'
import { GlossData, pickIpa } from '../../services/flicktionary/flicktionary-client'

export type GlossContent =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: GlossData }

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
  const [positioned, setPositioned] = useState(false)
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
  }, [anchor])

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
              const checkedSkillCount = [studyDraft.recognition, studyDraft.production, studyDraft.pronunciation].filter(
                Boolean
              ).length
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

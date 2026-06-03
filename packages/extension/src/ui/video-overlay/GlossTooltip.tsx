import { useEffect, useRef, useState } from 'react'
import { Trans } from '@lingui/react/macro'
import { computePosition, flip, shift, offset, autoUpdate } from '@floating-ui/dom'
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
  // highlighted word. Looking via hover stays free.
  onSave: () => void
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
          onClick={onSave}
          className='mt-1.5 self-start rounded-md bg-white/15 px-2.5 py-1 text-[13px] font-semibold text-white transition-colors hover:bg-white/25'
        >
          <Trans>Save</Trans>
        </button>
      )}
    </div>
  )
}

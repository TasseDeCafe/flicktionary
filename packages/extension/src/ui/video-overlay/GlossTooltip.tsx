import { useEffect, useRef, useState } from 'react'
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
}

// Hover gloss popover — mirrors the web app's fast-gloss popover. Positioned
// with @floating-ui/dom (fixed strategy, top placement, flip + shift), kept in
// sync via autoUpdate. No `display` toggling: React mounts/unmounts it, so the
// legacy `display:flex !important` hide trap is gone.
export function GlossTooltip({ anchor, word, content }: GlossTooltipProps) {
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
      style={{ visibility: positioned ? 'visible' : 'hidden' }}
      className='pointer-events-none fixed left-0 top-0 z-[2147483647] flex max-w-[320px] flex-col gap-1 rounded-lg bg-black/90 px-3 py-2 text-sm leading-snug text-white shadow-[0_4px_16px_rgba(0,0,0,0.4)]'
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
            {content.data.gloss || 'No translation available'}
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
    </div>
  )
}

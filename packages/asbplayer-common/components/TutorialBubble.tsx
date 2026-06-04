import { Trans } from '@lingui/react/macro'
import { Button } from '@flicktionary/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@flicktionary/ui/components/tooltip'

export interface TutorialBubbleProps {
  placement: 'left' | 'right' | 'top' | 'bottom' | 'bottom-start'
  text: React.ReactElement | string
  show?: boolean
  children: React.ReactElement
  onConfirm?: () => void
}

// A controlled, always-open-while-shown callout anchored to an (invisible,
// absolutely positioned) child element. Built on ui/tooltip — the `open` prop
// is fully controlled, so Radix's hover/focus dismissal never fires, and the
// content opts back into pointer events for the confirm button.
//
// Needs a <TooltipProvider> ancestor (the FTUE page root provides one).
const TutorialBubble: React.FC<TutorialBubbleProps> = ({ placement, show, onConfirm, text, children }) => {
  const side = placement === 'bottom-start' ? 'bottom' : placement
  const align = placement === 'bottom-start' ? 'start' : 'center'

  return (
    <Tooltip open={show === true}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      {/* z-index tops the extension's own video overlay (z-2147483647), which
          the FTUE page renders underneath the bubbles it points at. */}
      <TooltipContent side={side} align={align} className='pointer-events-auto z-[2147483648] max-w-xs'>
        <div className='flex flex-col gap-2 p-1'>
          <div className='text-sm'>{text}</div>
          {onConfirm && (
            <Button type='button' variant='secondary' size='sm' className='w-full' onClick={onConfirm}>
              <Trans>Got it</Trans>
            </Button>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

export default TutorialBubble

import { Tooltip, TooltipContent, TooltipTrigger } from '@flicktionary/ui/components/tooltip'
import { useLingui } from '@lingui/react/macro'
import LogoIcon from './LogoIcon'

type Anchor = 'top' | 'bottom'

// The minimal re-enable affordance shown instead of the full controls bar
// while the global extension switch is off: the same pill shell shrunk to a
// single dimmed logo button, in the same pause-triggered position, so on/off
// live in the same place. Clicking it flips the global switch back on.
interface Props {
  anchor: Anchor
  tooltipsEnabled: boolean
  onEnable: () => void
}

const VideoOverlayDisabled = ({ anchor, tooltipsEnabled, onEnable }: Props) => {
  const { t } = useLingui()

  // Tooltips open toward the video interior, same as the full bar.
  const tooltipSide: Anchor = anchor === 'bottom' ? 'top' : 'bottom'

  const button = (
    <button
      type='button'
      className='inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-white/10 [&_img]:size-6 [&_svg]:size-6'
      onClick={onEnable}
    >
      <LogoIcon className='opacity-60 grayscale hover:opacity-100 hover:grayscale-0' />
    </button>
  )

  return (
    <div className='inline-flex w-auto flex-row flex-nowrap items-center justify-center rounded-2xl bg-black/70'>
      {tooltipsEnabled ? (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side={tooltipSide} sideOffset={8}>
            {t`Turn Flicktionary on`}
          </TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
    </div>
  )
}

export default VideoOverlayDisabled

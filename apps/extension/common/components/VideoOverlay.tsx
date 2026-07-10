import React, { useCallback, useMemo, useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, SlidersHorizontalIcon, CaptionsIcon } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@flicktionary/ui/components/tooltip'
import { ControlType, VideoOverlayModel, PlayMode } from '@asbplayer-fork/common'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { useLingui } from '@lingui/react/macro'
import LogoIcon from './LogoIcon'
import SubtitlesOffIcon from './SubtitlesOffIcon'
import HoldableIconButton from './HoldableIconButton'
import PlayModeSelector from './PlayModeSelector'
import ScrollableNumberControls from './ScrollableNumberControls'

type Anchor = 'top' | 'bottom'

// The overlay chrome is always white-on-black regardless of theme (it sits on
// video), so these are hardcoded colours, not theme tokens — ported from the
// old tss-react classes.
const activeIconClassName = 'text-white'
const inactiveIconClassName = 'text-[rgba(120,120,120,0.7)]'

// MUI IconButton parity: 24px icon in a 40px circular hit target.
const iconButtonClassName =
  'inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-white/10 disabled:pointer-events-none [&_img]:size-6 [&_svg]:size-6'

// Tooltip wrapper that can be disabled wholesale (small screens) and renders
// its content into the surface's portal container via the context default.
const OverlayTooltip = ({
  title,
  enabled,
  side,
  children,
}: {
  title: string
  enabled: boolean
  side: Anchor
  children: React.ReactNode
}) => {
  if (!enabled) {
    return children
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} sideOffset={8}>
        {title}
      </TooltipContent>
    </Tooltip>
  )
}

interface Props {
  model?: VideoOverlayModel
  className?: string
  anchor: Anchor
  tooltipsEnabled: boolean
  initialControlType: ControlType
  onScrollToControlType: (controlType: ControlType) => void
  onLoadSubtitles?: () => void
  onOffset: (offset: number) => void
  onPlaybackRate: (playbackRate: number) => void
  onPlayModeSelected: (playMode: PlayMode) => void
  onSeek: (timestamp: number) => void
  onToggleSubtitles: () => void
}

const VideoOverlay = React.forwardRef<HTMLDivElement, Props>(function VideoOverlay(
  {
    model,
    className,
    anchor,
    tooltipsEnabled,
    initialControlType,
    onScrollToControlType,
    onLoadSubtitles,
    onOffset,
    onPlaybackRate,
    onPlayModeSelected,
    onSeek,
    onToggleSubtitles,
  }: Props,
  ref
) {
  const offsetInputRef = React.useRef<HTMLInputElement>(undefined)
  const playbackInputRef = React.useRef<HTMLInputElement>(undefined)
  const [playModeSelectorOpen, setPlayModeSelectorOpen] = useState<boolean>(false)
  const [numberControlType, setNumberControlType] = useState<ControlType>(ControlType.timeDisplay)

  const handleScrollToControlType = useCallback(
    (controlType: ControlType) => {
      setNumberControlType(controlType)
      onScrollToControlType(controlType)
    },
    [onScrollToControlType]
  )

  const handlePlayModeSelected = useCallback(
    (playMode: PlayMode) => {
      onPlayModeSelected(playMode)
      setPlayModeSelectorOpen(false)
    },
    [onPlayModeSelected]
  )

  const handleOffsetToPrevious = useCallback(() => {
    if (!model || model.previousSubtitleTimestamp === undefined) {
      return
    }

    onOffset(model.currentTimestamp - model.previousSubtitleTimestamp)
  }, [onOffset, model])

  const handleOffsetToNext = useCallback(() => {
    if (!model || model.nextSubtitleTimestamp === undefined) {
      return
    }

    onOffset(model.currentTimestamp - model.nextSubtitleTimestamp)
  }, [onOffset, model])

  const handleIncrementOffset = useCallback(() => {
    if (!model) {
      return
    }

    onOffset(model.offset + 100)
  }, [onOffset, model])

  const handleDecrementOffset = useCallback(() => {
    if (!model) {
      return
    }

    onOffset(model.offset - 100)
  }, [onOffset, model])

  const handleDecrementPlaybackRate = useCallback(() => {
    if (!model) {
      return
    }

    onPlaybackRate(Math.max(0.1, model.playbackRate - 0.1))
  }, [onPlaybackRate, model])

  const handleIncrementPlaybackRate = useCallback(() => {
    if (!model) {
      return
    }

    onPlaybackRate(Math.min(5, model.playbackRate + 0.1))
  }, [onPlaybackRate, model])

  const handleSeekToPreviousSubtitle = useCallback(() => {
    if (!model || model.previousSubtitleTimestamp === undefined) {
      return
    }

    onSeek(model.previousSubtitleTimestamp)
  }, [onSeek, model])

  const handleSeekBackwards = useCallback(() => {
    if (!model) {
      return
    }

    onSeek(Math.max(0, model.currentTimestamp - 10000))
  }, [onSeek, model])

  const handleSeekToNextSubtitle = useCallback(() => {
    if (!model || model.nextSubtitleTimestamp === undefined) {
      return
    }

    onSeek(model.nextSubtitleTimestamp)
  }, [onSeek, model])

  const handleSeekForwards = useCallback(() => {
    if (!model) {
      return
    }

    onSeek(model.currentTimestamp + 10000)
  }, [onSeek, model])

  const handleLeftNumberControl = useCallback(() => {
    switch (numberControlType) {
      case ControlType.timeDisplay:
        if (model?.emptySubtitleTrack) {
          handleSeekBackwards()
        } else {
          handleSeekToPreviousSubtitle()
        }
        break
      case ControlType.subtitleOffset:
        handleOffsetToPrevious()
        break
      case ControlType.playbackRate:
        handleDecrementPlaybackRate()
        break
    }
  }, [
    numberControlType,
    model?.emptySubtitleTrack,
    handleSeekBackwards,
    handleSeekToPreviousSubtitle,
    handleOffsetToPrevious,
    handleDecrementPlaybackRate,
  ])

  const handleRightNumberControl = useCallback(() => {
    switch (numberControlType) {
      case ControlType.timeDisplay:
        if (model?.emptySubtitleTrack) {
          handleSeekForwards()
        } else {
          handleSeekToNextSubtitle()
        }
        break
      case ControlType.subtitleOffset:
        handleOffsetToNext()
        break
      case ControlType.playbackRate:
        handleIncrementPlaybackRate()
        break
    }
  }, [
    numberControlType,
    model?.emptySubtitleTrack,
    handleSeekForwards,
    handleSeekToNextSubtitle,
    handleOffsetToNext,
    handleIncrementPlaybackRate,
  ])

  const handleHoldLeftNumberControl = useCallback(() => {
    switch (numberControlType) {
      case ControlType.timeDisplay:
        // ignore
        break
      case ControlType.subtitleOffset:
        handleIncrementOffset()
        break
      case ControlType.playbackRate:
        handleDecrementPlaybackRate()
        break
    }
  }, [numberControlType, handleIncrementOffset, handleDecrementPlaybackRate])

  const handleHoldRightNumberControl = useCallback(() => {
    switch (numberControlType) {
      case ControlType.timeDisplay:
        // ignore
        break
      case ControlType.subtitleOffset:
        handleDecrementOffset()
        break
      case ControlType.playbackRate:
        handleIncrementPlaybackRate()
        break
    }
  }, [numberControlType, handleDecrementOffset, handleIncrementPlaybackRate])

  const { t } = useLingui()
  const { leftNumberControlTitle, numberControlTitle, rightNumberControlTitle } = useMemo(() => {
    switch (numberControlType) {
      case ControlType.timeDisplay:
        return {
          leftNumberControlTitle: model?.emptySubtitleTrack ? t`Seek backward` : t`Seek to previous subtitle`,
          numberControlTitle: t`Current Timestamp`,
          rightNumberControlTitle: model?.emptySubtitleTrack ? t`Seek forward` : t`Seek to next subtitle`,
        }
      case ControlType.subtitleOffset:
        return {
          leftNumberControlTitle: t`Increase offset to so that previous subtitle is at current position. Hold to increase by 100ms.`,
          numberControlTitle: t`Subtitle Offset`,
          rightNumberControlTitle: t`Decrease offset to so that next subtitle is at current position. Hold to decrease by 100ms.`,
        }

      case ControlType.playbackRate:
        return {
          leftNumberControlTitle: t`Decrease playback rate`,
          numberControlTitle: t`Playback Rate`,
          rightNumberControlTitle: t`Increase playback rate`,
        }
    }
  }, [numberControlType, model, t])

  if (!model) {
    return null
  }

  // Tooltips (like the play-mode popover) open toward the video INTERIOR: the
  // bar sits flush against a video edge, so the anchor side has no room — a
  // tooltip there lands outside the video where host-page chrome can overlap
  // it (e.g. YouTube, where the overlay deliberately sits below the masthead
  // z-index) and Radix's collision shifting makes the gap look inconsistent.
  const tooltipSide: Anchor = anchor === 'bottom' ? 'top' : 'bottom'

  let rightNumberControlDisabled: boolean
  let leftNumberControlDisabled: boolean

  switch (numberControlType) {
    case ControlType.timeDisplay:
      rightNumberControlDisabled =
        (!model.emptySubtitleTrack && model.nextSubtitleTimestamp === undefined) || model.recording
      leftNumberControlDisabled =
        (!model.emptySubtitleTrack && model.previousSubtitleTimestamp === undefined) ||
        model.recording ||
        model.currentTimestamp === 0
      break
    case ControlType.subtitleOffset:
      rightNumberControlDisabled = model.nextSubtitleTimestamp === undefined || model.recording
      leftNumberControlDisabled = model.previousSubtitleTimestamp === undefined || model.recording
      break
    case ControlType.playbackRate:
      rightNumberControlDisabled = model.playbackRate >= 5 || model.recording
      leftNumberControlDisabled = model.playbackRate <= 0.1 || model.recording
      break
  }

  return (
    <div
      ref={ref}
      className={cn(
        'inline-flex w-auto flex-row flex-nowrap items-center justify-center rounded-2xl bg-black/70',
        className
      )}
    >
      {onLoadSubtitles && (
        <OverlayTooltip enabled={tooltipsEnabled} side={tooltipSide} title={t`Load Subtitles`}>
          <span>
            <button type='button' className={iconButtonClassName} disabled={model.recording} onClick={onLoadSubtitles}>
              <LogoIcon className={model.recording ? 'opacity-50' : undefined} />
            </button>
          </span>
        </OverlayTooltip>
      )}
      {!model.emptySubtitleTrack && !model.subtitleToggleHidden && (
        <OverlayTooltip enabled={tooltipsEnabled} side={tooltipSide} title={t`Toggle subtitles`}>
          <span>
            <button
              type='button'
              className={iconButtonClassName}
              disabled={model.recording}
              onClick={onToggleSubtitles}
            >
              {model.subtitlesAreVisible && (
                <SubtitlesOffIcon className={model.recording ? inactiveIconClassName : activeIconClassName} />
              )}
              {!model.subtitlesAreVisible && (
                <CaptionsIcon className={model.recording ? inactiveIconClassName : activeIconClassName} />
              )}
            </button>
          </span>
        </OverlayTooltip>
      )}
      {!model.emptySubtitleTrack && (
        <PlayModeSelector
          open={playModeSelectorOpen}
          onOpenChange={setPlayModeSelectorOpen}
          side={anchor === 'bottom' ? 'top' : 'bottom'}
          selectedPlayMode={model.playMode}
          onPlayMode={handlePlayModeSelected}
        >
          {/* PopoverTrigger(asChild) wraps the same tooltip+button structure
              the other controls use; the tooltip trigger nests inside it. */}
          <span>
            <OverlayTooltip enabled={tooltipsEnabled} side={tooltipSide} title={t`Playback Mode`}>
              <span>
                <button type='button' className={iconButtonClassName} disabled={model.recording}>
                  <SlidersHorizontalIcon className={model.recording ? inactiveIconClassName : activeIconClassName} />
                </button>
              </span>
            </OverlayTooltip>
          </span>
        </PlayModeSelector>
      )}
      {!model.recording && (
        <>
          <OverlayTooltip enabled={tooltipsEnabled} side={tooltipSide} title={leftNumberControlTitle}>
            <span>
              <HoldableIconButton
                className={iconButtonClassName}
                onClick={handleLeftNumberControl}
                onHold={handleHoldLeftNumberControl}
                disabled={leftNumberControlDisabled}
              >
                <ChevronLeftIcon className={leftNumberControlDisabled ? inactiveIconClassName : activeIconClassName} />
              </HoldableIconButton>
            </span>
          </OverlayTooltip>
          <OverlayTooltip enabled={tooltipsEnabled} side={tooltipSide} title={numberControlTitle}>
            <div>
              <ScrollableNumberControls
                offsetInputRef={offsetInputRef}
                playbackRateInputRef={playbackInputRef}
                offset={model.offset}
                onOffset={onOffset}
                playbackRate={model.playbackRate}
                onPlaybackRate={onPlaybackRate}
                initialControlType={initialControlType}
                onScrollTo={handleScrollToControlType}
                currentMilliseconds={model.currentTimestamp}
              />
            </div>
          </OverlayTooltip>
          <OverlayTooltip enabled={tooltipsEnabled} side={tooltipSide} title={rightNumberControlTitle}>
            <span>
              <HoldableIconButton
                className={iconButtonClassName}
                onClick={handleRightNumberControl}
                onHold={handleHoldRightNumberControl}
                disabled={rightNumberControlDisabled}
              >
                <ChevronRightIcon
                  className={rightNumberControlDisabled ? inactiveIconClassName : activeIconClassName}
                />
              </HoldableIconButton>
            </span>
          </OverlayTooltip>
        </>
      )}
    </div>
  )
})

export default VideoOverlay

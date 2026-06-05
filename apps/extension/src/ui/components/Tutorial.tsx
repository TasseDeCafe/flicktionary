import React, { useState, useEffect, useRef } from 'react'
import { Play } from 'lucide-react'
import { Trans } from '@lingui/react/macro'
import { Button } from '@flicktionary/ui/components/button'
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@flicktionary/ui/components/dialog'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import TabRegistry from '@/services/tab-registry'
import { SettingsProvider } from '@asbplayer-fork/common/settings'
import { ExtensionSettingsStorage } from '@/services/extension-settings-storage'
import { AsbPlayerToVideoCommandV2, RequestSubtitlesMessage, RequestSubtitlesResponse } from '@asbplayer-fork/common'
import TutorialBubble from '@asbplayer-fork/common/components/TutorialBubble'
import { isFirefox } from '@asbplayer-fork/common/browser-detection'

const settingsProvider = new SettingsProvider(new ExtensionSettingsStorage())
const tabRegistry = new TabRegistry(settingsProvider)
// One above the extension's own video overlay (z-2147483647), which this page
// renders for real underneath the tutorial dialogs/bubbles.
const zTopClass = 'z-[2147483648]'

const useExtensionState = () => {
  const [loadedSubtitlesCount, setLoadedSubtitlesCount] = useState<number>()
  const [currentTabId, setCurrentTabId] = useState<number>()
  useEffect(() => {
    browser.tabs.getCurrent().then((t) => setCurrentTabId(t?.id))
  }, [])
  useEffect(() => {
    const interval = setInterval(() => {
      tabRegistry.activeVideoElements().then(async (elems) => {
        const currentElem = elems.find((elem) => elem.id === currentTabId && elem.synced)

        if (currentElem !== undefined) {
          const message: AsbPlayerToVideoCommandV2<RequestSubtitlesMessage> = {
            sender: 'asbplayerv2',
            message: {
              command: 'request-subtitles',
            },
            tabId: currentElem.id,
            src: currentElem.src,
          }
          const response = (await browser.runtime.sendMessage(message)) as RequestSubtitlesResponse | undefined

          setLoadedSubtitlesCount(response?.subtitles?.length)
        }
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [currentTabId])
  return { loadedSubtitlesCount }
}

enum Step {
  toolbar = 1,
  loadSubtitles = 2,
  overlay = 4,
  overlayScrollControl = 5,
  almostDone = 6,
  done = 7,
}

const ToolbarBubble: React.FC<{ show: boolean; onConfirm: () => void }> = ({ show, onConfirm }) => {
  return (
    <TutorialBubble
      show={show}
      placement='bottom'
      text={
        <Trans>
          Click the 🧩 icon in the toolbar, and select <b>asbplayer</b> to open the asbplayer <b>Popup</b>.
          <p />
          Use the {isFirefox ? '⚙' : '📌'} button to pin asbplayer to the toolbar for easy access.
        </Trans>
      }
      onConfirm={onConfirm}
    >
      <div style={{ position: 'fixed', right: isFirefox ? 60 : 185, top: 5 }} />
    </TutorialBubble>
  )
}

const LoadSubtitlesDialog: React.FC<{ open: boolean; count?: number; onClose: () => void }> = ({
  open,
  count,
  onClose,
}) => {
  return (
    <Dialog open={open}>
      <DialogContent
        className={zTopClass}
        overlayClassName={zTopClass}
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <DialogTitle className='sr-only'>
          <Trans>Tutorial</Trans>
        </DialogTitle>
        {count === undefined && !isFirefox && (
          <div className='text-sm'>
            <Trans>
              The first step to using asbplayer is always to load subtitles onto a video. <b>Right-click</b> the video
              and choose the asbplayer <b>Load Subtitles</b> menu item.
              <p />
              Hint: asbplayer can also <b>auto-load</b> detected subtitles on supported sites.
            </Trans>
          </div>
        )}
        {count === undefined && isFirefox && (
          <div className='text-sm'>
            <Trans>
              The first step to using asbplayer is always to load subtitles onto a video. <b>Right-click</b> on the
              video and find the asbplayer <b>context menu</b> to load subtitles.
            </Trans>
          </div>
        )}
        {isFirefox && (
          <DialogFooter>
            <Button type='button' variant='ghost' onClick={onClose}>
              <Trans>OK</Trans>
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

const OverlayBubble: React.FC<{ show: boolean; onConfirm: () => void }> = ({ show, onConfirm }) => {
  return (
    <TutorialBubble
      show={show}
      placement='bottom'
      text={
        <Trans>
          Use the <b>Video Overlay</b> to <b>mine</b> and <b>toggle</b> subtitles, <b>switch playback modes</b>, and
          more.
        </Trans>
      }
      onConfirm={onConfirm}
    >
      <div
        style={{
          position: 'absolute',
          top: 55,
          left: '50%',
          transform: 'translateX(calc(-50% - 85px))',
        }}
      />
    </TutorialBubble>
  )
}

const OverlayScrollBubble: React.FC<{ show: boolean; onConfirm: () => void }> = ({ show, onConfirm }) => {
  return (
    <TutorialBubble
      show={show}
      placement='bottom'
      text={
        <Trans>
          <b>Scroll</b> the rightmost control to switch between <b>subtitle navigation</b>, <b>subtitle offset</b>, and{' '}
          <b>playback rate</b> controls.
        </Trans>
      }
      onConfirm={onConfirm}
    >
      <div
        style={{
          position: 'absolute',
          top: 55,
          left: '50%',
          transform: 'translateX(calc(-50% + 80px))',
        }}
      />
    </TutorialBubble>
  )
}

const FinishedDialog: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  return (
    <Dialog open={open}>
      <DialogContent
        className={zTopClass}
        overlayClassName={zTopClass}
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <DialogTitle className='sr-only'>
          <Trans>Tutorial</Trans>
        </DialogTitle>
        <div className='text-sm'>
          <Trans>That's it for the basics! Feel free to play around on this page.</Trans>
        </div>
        <DialogFooter>
          <Button type='button' variant='ghost' onClick={onClose}>
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const Tutorial: React.FC<{ className?: string; show: boolean }> = ({ className, show }) => {
  const { loadedSubtitlesCount } = useExtensionState()
  const [step, setStep] = useState<Step>(Step.toolbar)

  useEffect(() => {
    if (step === Step.loadSubtitles && loadedSubtitlesCount !== undefined) {
      setStep(Step.overlay)
    }
  }, [step, loadedSubtitlesCount])

  useEffect(() => {
    if (step == Step.overlay) {
      settingsProvider.getSingle('streamingEnableOverlay').then((overlayEnabled) => {
        if (overlayEnabled) {
          videoRef.current?.pause()
        } else {
          setStep(Step.almostDone)
        }
      })
    }
  }, [step])

  const [playing, setPlaying] = useState<boolean>(false)
  const videoRef = useRef<HTMLVideoElement | null>(undefined)

  const handleVideoClick = () => {
    if (playing) {
      videoRef.current?.pause()
    } else {
      videoRef.current?.play()
    }
  }

  const [showLoadSubtitles, setShowLoadSubtitles] = useState<boolean>(true)

  return (
    <div className={cn('bg-background relative', className)}>
      {show && (
        <div className='animate-in fade-in absolute flex h-full w-full items-center justify-center duration-300'>
          <div className='max-h-dvh w-full sm:w-[80%]'>
            <div className='relative h-full max-h-dvh w-full'>
              <video
                ref={(elm) => {
                  videoRef.current = elm

                  if (elm) {
                    elm.volume = Math.min(elm.volume, 0.5)
                  }
                }}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                className='max-h-dvh w-full'
                src={browser.runtime.getURL('/assets/tutorial.mp4')}
                onClick={handleVideoClick}
              />
              <div
                style={{
                  position: 'absolute',
                  transform: 'translateY(-50%) translateX(-50%) scale(400%)',
                  top: '50%',
                  left: '50%',
                }}
              >
                {!playing && (
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='rounded-full'
                    onClick={() => videoRef.current?.play()}
                  >
                    <Play className='size-6' />
                  </Button>
                )}
              </div>
              <OverlayBubble
                show={show && step === Step.overlay}
                onConfirm={() => setStep(Step.overlayScrollControl)}
              />
              <OverlayScrollBubble
                show={show && step === Step.overlayScrollControl}
                onConfirm={() => setStep(Step.almostDone)}
              />
            </div>
          </div>
        </div>
      )}
      <ToolbarBubble show={show && step === Step.toolbar} onConfirm={() => setStep(Step.loadSubtitles)} />
      <LoadSubtitlesDialog
        open={show && step === Step.loadSubtitles && showLoadSubtitles}
        count={loadedSubtitlesCount}
        onClose={() => setShowLoadSubtitles(false)}
      />
      <FinishedDialog open={show && step === Step.almostDone} onClose={() => setStep(Step.done)} />
    </div>
  )
}

export default Tutorial

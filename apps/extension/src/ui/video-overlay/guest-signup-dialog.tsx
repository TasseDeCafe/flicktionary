import { useLayoutEffect, useRef, useState } from 'react'
import { Trans } from '@lingui/react/macro'

export interface GuestSignupDialogProps {
  // Used only to center the dialog over the video, clamped into the viewport.
  video: HTMLMediaElement
  onSignUp: () => void
  onDismiss: () => void
}

// "Create a free account to save" dialog, shown when a guest (anonymous
// gloss-only session) tries to save a word. Same in-video presentation as the
// CEFR picker: lives in the popover shadow host, `position: fixed`, centered
// against the video's viewport rect (correct in fullscreen too).
export const GuestSignupDialog = ({ video, onSignUp, onDismiss }: GuestSignupDialogProps) => {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const v = video.getBoundingClientRect()
    const left = v.left + v.width / 2 - el.offsetWidth / 2
    const top = v.top + v.height / 2 - el.offsetHeight / 2
    setPos({ left: Math.max(12, left), top: Math.max(12, top) })
  }, [video])

  return (
    <div
      ref={ref}
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        visibility: pos ? 'visible' : 'hidden',
      }}
      className='fixed z-[2147483647] flex w-[320px] max-w-[calc(100vw-24px)] flex-col gap-2.5 rounded-xl bg-[rgba(20,20,20,0.96)] p-4 font-sans text-white shadow-[0_8px_28px_rgba(0,0,0,0.5)]'
    >
      <p className='m-0 text-[15px] font-semibold leading-tight'>
        <Trans>Save words with a free account</Trans>
      </p>
      <p className='m-0 text-xs leading-snug text-white/65'>
        <Trans>
          Translations are free to use. Create a Flicktionary account to save words from your videos and practice them
          later.
        </Trans>
      </p>
      <button
        type='button'
        className='cursor-pointer rounded-lg border border-white/20 bg-white/10 py-2.5 text-sm font-semibold text-white transition-colors hover:border-white/40 hover:bg-white/20'
        onClick={onSignUp}
      >
        <Trans>Create free account</Trans>
      </button>
      <div className='flex justify-end'>
        <button
          type='button'
          className='cursor-pointer border-none bg-transparent px-2.5 py-1.5 text-xs text-white/70 hover:text-white'
          onClick={onDismiss}
        >
          <Trans>Not now</Trans>
        </button>
      </div>
    </div>
  )
}

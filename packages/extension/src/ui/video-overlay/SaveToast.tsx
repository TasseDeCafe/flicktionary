import { useLayoutEffect, useRef, useState } from 'react'

export interface SaveToastProps {
  text: string
  isError: boolean
  video: HTMLMediaElement
}

// Save confirmation / error toast, port of the legacy `_showNotification`.
// Auto-dismissal is owned by SubtitleOverlayApp (which unmounts this after the
// matching duration); here we just position near the video's bottom-center and
// run the fade-in-out animation. The `display:flex !important` hide trap is gone
// — React mounts/unmounts instead of toggling display.
export function SaveToast({ text, isError, video }: SaveToastProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const v = video.getBoundingClientRect()
    setPos({ left: v.left + v.width / 2 - el.offsetWidth / 2, top: v.bottom - 60 })
  }, [video, text])

  return (
    <div
      ref={ref}
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        visibility: pos ? 'visible' : 'hidden',
      }}
      className={
        'pointer-events-none fixed z-[2147483647] max-w-[320px] rounded-md px-4 py-2 text-center text-sm text-white shadow-[0_2px_10px_rgba(0,0,0,0.3)] ' +
        (isError
          ? 'animate-overlay-toast-error bg-[rgba(220,53,69,0.96)]'
          : 'animate-overlay-toast bg-[rgba(40,167,69,0.95)]')
      }
    >
      {text}
    </div>
  )
}

import { useLayoutEffect, useRef, useState } from 'react'
import { CEFR_LEVELS } from '../../services/flicktionary/flicktionary-client'
import { describeLanguageCode } from '../../services/flicktionary/youtube-context'

export interface CefrPickerProps {
  languageCode: string
  // Used only to center the picker over the video, clamped into the viewport.
  video: HTMLMediaElement
  onPick: (cefrLevel: string) => void
  onCancel: () => void
}

// In-video CEFR picker (A1–C2), shown when a save hits MISSING_CEFR. Port of
// the legacy `_showCefrPicker`. Lives in the popover shadow host (reparented to
// the fullscreen element when fullscreen), so its `position: fixed` centering
// against the video's viewport rect is correct in both states.
export function CefrPicker({ languageCode, video, onPick, onCancel }: CefrPickerProps) {
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

  const languageName = describeLanguageCode(languageCode) ?? languageCode.toUpperCase()

  return (
    <div
      ref={ref}
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        visibility: pos ? 'visible' : 'hidden',
      }}
      className='fixed z-[2147483647] flex w-[300px] max-w-[calc(100vw-24px)] flex-col gap-2.5 rounded-xl bg-[rgba(20,20,20,0.96)] p-4 font-sans text-white shadow-[0_8px_28px_rgba(0,0,0,0.5)]'
    >
      <p className='m-0 text-[15px] font-semibold leading-tight'>Your {languageName} level</p>
      <p className='m-0 text-xs leading-snug text-white/65'>Set this once to start saving words from this language.</p>
      <div className='grid grid-cols-3 gap-2'>
        {CEFR_LEVELS.map((level) => (
          <button
            key={level}
            type='button'
            className='cursor-pointer rounded-lg border border-white/20 bg-white/10 py-2.5 text-sm font-semibold text-white transition-colors hover:border-white/40 hover:bg-white/20'
            onClick={() => onPick(level)}
          >
            {level}
          </button>
        ))}
      </div>
      <div className='flex justify-end'>
        <button
          type='button'
          className='cursor-pointer border-none bg-transparent px-2.5 py-1.5 text-xs text-white/70 hover:text-white'
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

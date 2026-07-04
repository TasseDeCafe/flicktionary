import { useLingui } from '@lingui/react/macro'
import { MessageCircle } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { KBD_CORNER_CLASS, Kbd } from '@flicktionary/ui/components/kbd'

type Props = {
  hasUnread: boolean
  isGenerating: boolean
  isFailed: boolean
  // Hotkey badge (e.g. 'C') — pass only when the hosting view actually binds
  // the key and the device has a keyboard.
  kbdHint?: string
  onClick: () => void
}

// Chat glyph with a state dot. Precedence: generating > failed > unread > none.
// Cues are non-color (pulse vs solid + glyph) so the state isn't color-only.
export const ChatHeaderButton = ({ hasUnread, isGenerating, isFailed, kbdHint, onClick }: Props) => {
  const { t } = useLingui()

  const state: 'generating' | 'failed' | 'unread' | 'none' = isGenerating
    ? 'generating'
    : isFailed
      ? 'failed'
      : hasUnread
        ? 'unread'
        : 'none'

  const ariaLabel =
    state === 'generating'
      ? t`Chat — preparing answer`
      : state === 'failed'
        ? t`Chat — answer failed`
        : state === 'unread'
          ? t`Chat — new answer ready`
          : t`Open chat`

  return (
    <Button variant='ghost' size='icon' onClick={onClick} aria-label={ariaLabel} className='relative'>
      <MessageCircle className='size-6 md:size-5' />
      {kbdHint && <Kbd className={KBD_CORNER_CLASS}>{kbdHint}</Kbd>}
      {state === 'generating' && (
        <span className='absolute top-1 right-1 size-2.5 animate-pulse rounded-full bg-amber-500 motion-reduce:animate-none' />
      )}
      {state === 'failed' && (
        <span className='absolute top-0.5 right-0.5 flex size-3.5 items-center justify-center rounded-full bg-red-600 text-[9px] leading-none font-bold text-white'>
          !
        </span>
      )}
      {state === 'unread' && <span className='absolute top-1 right-1 size-2.5 rounded-full bg-green-500' />}
    </Button>
  )
}

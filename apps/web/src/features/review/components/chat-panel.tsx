import { useEffect, useMemo, useRef } from 'react'
import { useLingui } from '@lingui/react/macro'
import { X } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@flicktionary/ui/components/dialog'
import { useListChatForCard, useMarkChatRead } from '../api/review-hooks'
import { PerCardChat } from './per-card-chat'

type ChatTarget = {
  cardId: string
  sessionId?: string
  highlightId?: string | null
}

// Mark-read sync, decoupled from how the chat is presented (mobile sheet vs
// desktop side panel). Call it once where `chatOpen` lives so the two layouts
// don't both fire it.
export const useChatReadSync = ({ open, cardId, sessionId }: { open: boolean; cardId: string; sessionId?: string }) => {
  const { mutate: markRead } = useMarkChatRead(cardId, sessionId)
  const { data: messages } = useListChatForCard(cardId)

  // Newest assistant turn currently in view — both initial load of an
  // already-unread chat and a reply landing while the panel is open.
  const latestAssistantAt = useMemo(() => {
    let max: string | null = null
    for (const m of messages ?? []) {
      if (m.role === 'assistant' && (max === null || m.createdAt > max)) max = m.createdAt
    }
    return max
  }, [messages])

  const prevOpenRef = useRef(false)
  // Keyed by cardId so switching cards while open doesn't suppress the new
  // card's assistant mark.
  const lastMarkedAssistantRef = useRef<{ cardId: string; at: string | null }>({ cardId, at: null })

  // Reset tracking on card switch so the new card marks correctly.
  useEffect(() => {
    prevOpenRef.current = false
    lastMarkedAssistantRef.current = { cardId, at: null }
  }, [cardId])

  // Every false→true transition re-persists read state (idempotent upsert), so
  // reopening after a later unread answer clears it again. Not gated by the
  // assistant ref — opening should clear persisted unread even before messages load.
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      markRead({ cardId })
    }
    prevOpenRef.current = open
  }, [open, cardId, markRead])

  // While open, mark read whenever the latest assistant turn advances.
  useEffect(() => {
    if (!open || latestAssistantAt === null) return
    const ref = lastMarkedAssistantRef.current
    if (ref.cardId === cardId && ref.at === latestAssistantAt) return
    lastMarkedAssistantRef.current = { cardId, at: latestAssistantAt }
    markRead({ cardId })
  }, [open, latestAssistantAt, cardId, markRead])
}

// Mobile: full-screen slide-up sheet (Radix Dialog, no vaul). No dimming scrim
// — it flashes during the slide-up and the opaque sheet covers everything.
export const ChatPanel = ({
  open,
  onOpenChange,
  cardId,
  sessionId,
  highlightId,
}: ChatTarget & {
  open: boolean
  onOpenChange: (open: boolean) => void
}) => {
  const { t } = useLingui()
  const contentRef = useRef<HTMLDivElement>(null)

  // iOS keyboard fix: a `fixed inset-0 h-dvh` sheet does NOT shrink when the
  // on-screen keyboard opens, so the bottom-anchored input ends up hidden
  // behind it. Track the visual viewport and pin the sheet to its height/offset
  // so the input stays just above the keyboard. Cleared on close.
  useEffect(() => {
    if (!open) return
    const vv = window.visualViewport
    const el = contentRef.current
    if (!vv || !el) return
    const apply = () => {
      el.style.height = `${vv.height}px`
      el.style.top = `${vv.offsetTop}px`
      el.style.bottom = 'auto'
    }
    apply()
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    return () => {
      vv.removeEventListener('resize', apply)
      vv.removeEventListener('scroll', apply)
      el.style.height = ''
      el.style.top = ''
      el.style.bottom = ''
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal>
      <DialogContent
        ref={contentRef}
        variant='fullScreen'
        showOverlay={false}
        showCloseButton={false}
        className='gap-0'
      >
        {/* Mirrors ModalScreen's header: close on the left, title beside it. */}
        <header className='flex h-14 shrink-0 items-center gap-2 border-b bg-background px-2'>
          <Button variant='ghost' size='icon' onClick={() => onOpenChange(false)} aria-label={t`Close`}>
            <X className='size-6 md:size-5' />
          </Button>
          <DialogTitle className='min-w-0 flex-1 truncate text-base font-semibold'>{t`Chat`}</DialogTitle>
          <DialogDescription className='sr-only'>{t`Ask follow-up questions about this term.`}</DialogDescription>
        </header>
        <div className='min-h-0 flex-1 p-4'>
          <PerCardChat key={cardId} fill cardId={cardId} sessionId={sessionId} highlightId={highlightId} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Desktop: a real side panel laid out beside the card column (not an overlay),
// so the card stays readable + scrollable and prev/next stay reachable while
// it's open. Rendered as a flex sibling by the focus view.
export const ChatSidePanel = ({
  onClose,
  cardId,
  sessionId,
  highlightId,
}: ChatTarget & {
  onClose: () => void
}) => {
  const { t } = useLingui()
  return (
    <aside className='flex h-dvh w-[28rem] shrink-0 flex-col border-l bg-background'>
      <header className='flex h-14 shrink-0 items-center gap-2 border-b bg-background px-2'>
        <Button variant='ghost' size='icon' onClick={onClose} aria-label={t`Close`}>
          <X className='size-6 md:size-5' />
        </Button>
        <h2 className='min-w-0 flex-1 truncate text-base font-semibold'>{t`Chat`}</h2>
      </header>
      <div className='min-h-0 flex-1 p-4'>
        <PerCardChat key={cardId} fill cardId={cardId} sessionId={sessionId} highlightId={highlightId} />
      </div>
    </aside>
  )
}

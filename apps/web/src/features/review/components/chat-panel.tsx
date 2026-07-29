import { useEffect, useMemo, useRef } from 'react'
import { useLingui } from '@lingui/react/macro'
import { X } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@flicktionary/ui/components/dialog'
import { useListChatForCard, useMarkChatRead } from '../api/review-hooks'
import { useVisualViewportPin } from '@/hooks/use-visual-viewport-pin'
import { PerCardChat } from './per-card-chat'

type ChatTarget = {
  cardId: string
  sessionId?: string
  highlightId?: string | null
}

// Mark-read sync, decoupled from how the chat is presented (mobile sheet vs
// desktop side panel). Call it once where `chatOpen` lives so the two layouts
// don't both fire it.
// eslint-disable-next-line react-refresh/only-export-components -- the hook is deliberately co-located with the two chat layouts that share it; splitting a one-hook module for HMR purity isn't worth the indirection
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
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-event-handler -- `open` is owned by two different layouts (mobile sheet, desktop panel); detecting the false→true transition here keeps the read-persist in one place instead of in every open call site
    if (open && !prevOpenRef.current) {
      markRead({ cardId })
    }
    prevOpenRef.current = open
  }, [open, cardId, markRead])

  // While open, mark read whenever the latest assistant turn advances.
  useEffect(() => {
    /* eslint-disable react-you-might-not-need-an-effect/no-event-handler -- marks read when a new assistant turn ARRIVES while the panel is open — an async server push observed through the query cache, not a user event */
    if (!open || latestAssistantAt === null) return
    const ref = lastMarkedAssistantRef.current
    if (ref.cardId === cardId && ref.at === latestAssistantAt) return
    /* eslint-enable react-you-might-not-need-an-effect/no-event-handler */
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

  // Keeps the bottom-anchored composer above the iOS on-screen keyboard —
  // the `fixed inset-0 h-dvh` sheet doesn't shrink for it on its own.
  useVisualViewportPin(contentRef, open)

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
        <header className='bg-background flex h-14 shrink-0 items-center gap-2 border-b px-2'>
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
    <aside className='bg-background flex h-dvh w-[28rem] shrink-0 flex-col border-l'>
      <header className='bg-background flex h-14 shrink-0 items-center gap-2 border-b px-2'>
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

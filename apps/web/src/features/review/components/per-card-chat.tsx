import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import { orpcQuery } from '@/lib/transport/orpc-client'
import { Button } from '@flicktionary/ui/components/button'
import { MarkdownMessage } from '@flicktionary/ui/components/markdown-message'
import { Textarea } from '@flicktionary/ui/components/textarea'
import { ChevronDown, Send } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { useListChatForCard, useSendChatMessage } from '../api/review-hooks'
import { useGetProcessingStatus } from '@/features/sessions/api/sessions-hooks'

type Props = {
  cardId: string
  sessionId?: string
  // The highlight this card was created from, if any. When set together with
  // sessionId, the chat watches for a pending seed_card_chat job (an auto-seeded
  // answer to a saved note/preset) and shows a placeholder until it lands.
  highlightId?: string | null
  // When true the chat fills its parent (flex column, scrolling message list)
  // instead of capping at max-h-[400px]. Used inside the on-demand ChatPanel,
  // whose body owns the height. Requires min-h-0 on the parent chain to
  // actually contain the scroll.
  fill?: boolean
}

export const PerCardChat = ({ cardId, sessionId, highlightId, fill = false }: Props) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const { data: messages, isLoading } = useListChatForCard(cardId)
  const { mutate: sendMessage, isPending } = useSendChatMessage(cardId, sessionId)

  // Poll the session's processing status (only while something is in flight) to
  // know whether a seeded answer for this card's highlight is still being
  // generated. Disabled outside a session scope (e.g. the vocabulary view).
  const { data: processingStatus } = useGetProcessingStatus(sessionId ?? '', 2000)
  const isSeedPending =
    !!sessionId && !!highlightId && (processingStatus?.seedChatHighlightIds.includes(highlightId) ?? false)
  const isSeedFailed =
    !!sessionId && !!highlightId && (processingStatus?.failedSeedChatHighlightIds.includes(highlightId) ?? false)

  // When the seed job clears (pending → gone), refetch the chat so the freshly
  // generated turn appears without waiting for an incidental refetch.
  const wasSeedPending = useRef(false)
  useEffect(() => {
    if (wasSeedPending.current && !isSeedPending) {
      queryClient.invalidateQueries({
        queryKey: orpcQuery.cardChat.listForCard.key({ input: { cardId } }),
      })
    }
    wasSeedPending.current = isSeedPending
  }, [isSeedPending, cardId, queryClient])

  const [draft, setDraft] = useState('')
  const [optimisticUserContent, setOptimisticUserContent] = useState<string | null>(null)
  const [showJump, setShowJump] = useState(false)

  // The id of the last assistant message we already reacted to. A reply with a
  // newer id is treated as "freshly arrived" and gets anchored to the top.
  const lastAssistantId = messages?.reduce<string | undefined>(
    (acc, m) => (m.role === 'assistant' ? m.id : acc),
    undefined
  )

  // Scroll plumbing:
  //  - listRef       — the scrollable message container.
  //  - lastReplyRef  — wraps the newest assistant bubble so we can find its top.
  //  - endAnchorRef  — zero-height marker after the last real bubble (before the
  //                    spacer), so "is the latest content visible?" ignores the
  //                    empty spacer we add below.
  //  - spacerRef     — reserved empty space below the conversation; lets a short
  //                    reply scroll its top up to the container top (otherwise
  //                    there's nothing below it to scroll past).
  const listRef = useRef<HTMLDivElement>(null)
  const lastReplyRef = useRef<HTMLDivElement>(null)
  const endAnchorRef = useRef<HTMLDivElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null)
  const seenReplyId = useRef<string | undefined>(undefined)
  const initialized = useRef(false)
  const justSent = useRef(false)
  // Whether the newest content was in view at the last scroll event. Captured
  // before new content lands so we know if the user had scrolled up to re-read.
  const wasAtBottom = useRef(true)

  // Distance (px) of the latest real content's bottom edge past the visible
  // bottom. ≤0 means the latest turn is fully on screen.
  const distancePastBottom = () => {
    const el = listRef.current
    const anchor = endAnchorRef.current
    if (!el || !anchor) return 0
    return anchor.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom
  }

  const refreshJump = () => {
    const dist = distancePastBottom()
    wasAtBottom.current = dist <= 24
    setShowJump(dist > 24)
  }

  const scrollToLatest = () => {
    const el = listRef.current
    if (!el) return
    if (spacerRef.current) spacerRef.current.style.height = '0px'
    el.scrollTop = el.scrollHeight
    refreshJump()
  }

  useLayoutEffect(() => {
    const el = listRef.current
    if (!el || !messages) return

    // First time we have data (panel open / chat loaded): land at the bottom on
    // the latest turn, the way chat UIs conventionally open. Don't anchor-to-top
    // here — that's only for replies that arrive while the panel is open.
    if (!initialized.current) {
      initialized.current = true
      seenReplyId.current = lastAssistantId
      if (spacerRef.current) spacerRef.current.style.height = '0px'
      el.scrollTop = el.scrollHeight
      requestAnimationFrame(refreshJump)
      return
    }

    // A new assistant reply just landed: anchor its top to the top of the
    // viewport so the user starts reading at the beginning of the reply.
    const isNewReply = !!lastAssistantId && lastAssistantId !== seenReplyId.current
    if (isNewReply && lastReplyRef.current) {
      seenReplyId.current = lastAssistantId
      const replyEl = lastReplyRef.current
      // Reserve enough empty space below so a short reply can reach the top.
      if (spacerRef.current) {
        spacerRef.current.style.height = `${Math.max(0, el.clientHeight - replyEl.offsetHeight)}px`
      }
      // 12px == the container's p-3 top padding (where its content starts).
      const delta = replyEl.getBoundingClientRect().top - (el.getBoundingClientRect().top + 12)
      el.scrollTop += delta
      requestAnimationFrame(refreshJump)
      return
    }

    // Optimistic send / pending / seed placeholders: follow to the bottom, but
    // only if the user was already there (don't yank them down mid-read).
    if (spacerRef.current) spacerRef.current.style.height = '0px'
    if (justSent.current || wasAtBottom.current) {
      el.scrollTop = el.scrollHeight
    }
    justSent.current = false
    requestAnimationFrame(refreshJump)
  }, [messages, lastAssistantId, optimisticUserContent, isPending, isSeedPending, isSeedFailed])

  const handleSend = () => {
    const content = draft.trim()
    if (!content || isPending) return
    justSent.current = true
    setOptimisticUserContent(content)
    setDraft('')
    sendMessage(
      { cardId, content },
      {
        onSettled: () => {
          setOptimisticUserContent(null)
        },
      }
    )
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter inserts a newline. Ignore Enter while an IME
    // composition is active so picking a candidate doesn't fire a send.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      handleSend()
    }
  }

  return (
    <div className={cn('flex flex-col gap-3', fill && 'h-full min-h-0')}>
      <div className={cn('relative', fill && 'min-h-0 flex-1')}>
        <div
          ref={listRef}
          onScroll={refreshJump}
          className={cn(
            'flex flex-col gap-2 overflow-y-auto rounded-md border bg-gray-50 p-3',
            fill ? 'h-full' : 'max-h-[400px]'
          )}
        >
          {isLoading && <p className='text-muted-foreground text-sm'>{t`Loading chat…`}</p>}
          {!isLoading && (messages?.length ?? 0) === 0 && !optimisticUserContent && !isSeedPending && !isSeedFailed && (
            <p className='text-muted-foreground text-sm'>
              {t`Ask a follow-up question about this term. The model already has the methodology, your profile, and the surrounding scene loaded.`}
            </p>
          )}
          {messages?.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className='self-end rounded-lg bg-blue-100 px-3 py-2 text-sm whitespace-pre-wrap'>
                {m.content}
              </div>
            ) : (
              <div key={m.id} ref={m.id === lastAssistantId ? lastReplyRef : undefined} className='flex flex-col'>
                <MarkdownMessage
                  content={m.content}
                  className='self-start rounded-lg bg-white px-3 py-2 text-sm shadow-sm'
                />
              </div>
            )
          )}
          {optimisticUserContent && (
            <div className='self-end rounded-lg bg-blue-100 px-3 py-2 text-sm whitespace-pre-wrap opacity-70'>
              {optimisticUserContent}
            </div>
          )}
          {isPending && (
            <div className='self-start rounded-lg bg-white px-3 py-2 text-sm text-gray-500 shadow-sm'>{t`Thinking…`}</div>
          )}
          {isSeedPending && !isPending && (
            <div className='self-start rounded-lg bg-white px-3 py-2 text-sm text-gray-500 shadow-sm'>
              {t`Preparing your answer…`}
            </div>
          )}
          {isSeedFailed && !isSeedPending && !isPending && (
            <div className='self-start rounded-lg bg-white px-3 py-2 text-sm text-red-600 shadow-sm'>
              {t`We couldn't prepare this answer. Save the note again to retry.`}
            </div>
          )}
          {/* Marks the end of real content; the spacer below is excluded so the
              jump button / auto-follow ignore the reserved empty space. */}
          <div ref={endAnchorRef} aria-hidden className='h-0 w-full shrink-0' />
          <div ref={spacerRef} aria-hidden className='w-full shrink-0' style={{ height: 0 }} />
        </div>
        {showJump && (
          <Button
            type='button'
            variant='secondary'
            size='icon-sm'
            onClick={scrollToLatest}
            aria-label={t`Jump to latest`}
            className='absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border shadow-md'
          >
            <ChevronDown className='h-4 w-4' />
          </Button>
        )}
      </div>
      <div className='flex items-end gap-2'>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          className='max-h-40'
          placeholder={t`Ask anything about this term… (Enter to send, Shift+Enter for a new line)`}
          disabled={isPending}
        />
        <Button onClick={handleSend} disabled={!draft.trim() || isPending} aria-label={t`Send`}>
          <Send className='h-4 w-4' />
        </Button>
      </div>
    </div>
  )
}

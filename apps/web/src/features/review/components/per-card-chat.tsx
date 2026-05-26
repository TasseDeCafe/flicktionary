import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import { orpcQuery } from '@/lib/transport/orpc-client'
import { Button } from '@/components/ui/button'
import { MarkdownMessage } from '@/components/ui/markdown-message'
import { Textarea } from '@/components/ui/textarea'
import { Send } from 'lucide-react'
import { useListChatForCard, useSendChatMessage } from '../api/review-hooks'
import { useGetProcessingStatus } from '@/features/sessions/api/sessions-hooks'

type Props = {
  cardId: string
  sessionId?: string
  // The highlight this card was created from, if any. When set together with
  // sessionId, the chat watches for a pending seed_card_chat job (an auto-seeded
  // answer to a saved note/preset) and shows a placeholder until it lands.
  highlightId?: string | null
}

export const PerCardChat = ({ cardId, sessionId, highlightId }: Props) => {
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

  const handleSend = () => {
    const content = draft.trim()
    if (!content || isPending) return
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
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      handleSend()
    }
  }

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex max-h-[400px] flex-col gap-2 overflow-y-auto rounded-md border bg-gray-50 p-3'>
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
            <MarkdownMessage
              key={m.id}
              content={m.content}
              className='self-start rounded-lg bg-white px-3 py-2 text-sm shadow-sm'
            />
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
      </div>
      <div className='flex items-end gap-2'>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder={t`Ask anything about this term… (Cmd/Ctrl+Enter to send)`}
          disabled={isPending}
        />
        <Button onClick={handleSend} disabled={!draft.trim() || isPending} aria-label={t`Send`}>
          <Send className='h-4 w-4' />
        </Button>
      </div>
    </div>
  )
}

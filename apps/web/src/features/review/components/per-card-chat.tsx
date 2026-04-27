import { useEffect, useRef, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Send } from 'lucide-react'
import { useListChatForCard, useSendChatMessage } from '../api/review-hooks'

type Props = {
  cardId: string
}

export const PerCardChat = ({ cardId }: Props) => {
  const { t } = useLingui()
  const { data: messages, isLoading } = useListChatForCard(cardId)
  const { mutate: sendMessage, isPending } = useSendChatMessage(cardId)

  const [draft, setDraft] = useState('')
  const [optimisticUserContent, setOptimisticUserContent] = useState<string | null>(null)
  const listEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, optimisticUserContent])

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
        {!isLoading && (messages?.length ?? 0) === 0 && !optimisticUserContent && (
          <p className='text-muted-foreground text-sm'>
            {t`Ask a follow-up question about this chunk. The model already has the methodology, your profile, and the surrounding scene loaded.`}
          </p>
        )}
        {messages?.map((m) => (
          <div
            key={m.id}
            className={
              m.role === 'user'
                ? 'self-end rounded-lg bg-blue-100 px-3 py-2 text-sm whitespace-pre-wrap'
                : 'self-start rounded-lg bg-white px-3 py-2 text-sm whitespace-pre-wrap shadow-sm'
            }
          >
            {m.content}
          </div>
        ))}
        {optimisticUserContent && (
          <div className='self-end rounded-lg bg-blue-100 px-3 py-2 text-sm whitespace-pre-wrap opacity-70'>
            {optimisticUserContent}
          </div>
        )}
        {isPending && (
          <div className='self-start rounded-lg bg-white px-3 py-2 text-sm text-gray-500 shadow-sm'>{t`Thinking…`}</div>
        )}
        <div ref={listEndRef} />
      </div>
      <div className='flex items-end gap-2'>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder={t`Ask anything about this chunk… (Cmd/Ctrl+Enter to send)`}
          disabled={isPending}
        />
        <Button onClick={handleSend} disabled={!draft.trim() || isPending} aria-label={t`Send`}>
          <Send className='h-4 w-4' />
        </Button>
      </div>
    </div>
  )
}

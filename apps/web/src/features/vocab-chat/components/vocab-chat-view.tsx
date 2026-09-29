import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowRight, Check, Layers, Loader2, Send } from 'lucide-react'
import type { VocabChatMessage } from '@flicktionary/api-client/orpc-contracts/vocab-chat-contract'
import { getBackendErrorCodeFromError } from '@flicktionary/api-client/utils/backend-error-utils'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Button } from '@flicktionary/ui/components/button'
import { MarkdownMessage } from '@flicktionary/ui/components/markdown-message'
import { Skeleton } from '@flicktionary/ui/components/skeleton'
import { Textarea } from '@flicktionary/ui/components/textarea'
import { LanguageSelectField } from '@/components/language-select-field'
import { orpcQuery } from '@/lib/transport/orpc-client'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { useModalScreenClose } from '@/features/navigation/hooks/use-modal-screen-close'
import { useGetUserPrefs, useSetCefrForLanguage } from '@/features/sessions/api/sessions-hooks'
import { CefrStep } from '@/features/sessions/components/cefr-step'
import type { CefrLevel } from '@/features/sessions/constants/cefr'
import {
  useAddProposedItems,
  useSendVocabChatMessage,
  useStartVocabChat,
  useVocabChatThread,
} from '../api/vocab-chat-hooks'

const MESSAGE_MAX = 4000

const useSendErrorToast = () => {
  const { t } = useLingui()
  return (err: unknown) => {
    const code = getBackendErrorCodeFromError(err)
    if (code === 'CONTENT_BLOCKED') toast.error(t`This message can't be sent.`)
    else if (code === 'native_language_not_set') toast.error(t`Set your native language first.`)
    else toast.error(t`Failed to send message`)
  }
}

// An existing thread: history, proposals, composer.
export const VocabChatThreadView = ({ sessionId }: { sessionId: string }) => {
  const { t } = useLingui()
  const close = useModalScreenClose({ to: '/sessions' })
  const { data: thread, isLoading } = useVocabChatThread(sessionId)
  const { mutate: sendMessage, isPending } = useSendVocabChatMessage(sessionId)
  const showSendError = useSendErrorToast()
  const [pendingContent, setPendingContent] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const handleSend = () => {
    const content = draft.trim()
    if (!content || isPending) return
    setPendingContent(content)
    setDraft('')
    sendMessage(
      { sessionId, content },
      {
        onError: (err) => {
          setDraft(content)
          showSendError(err)
        },
        onSettled: () => setPendingContent(null),
      }
    )
  }

  const cardsLink = (
    <Button variant='ghost' size='sm' asChild>
      <Link to='/sessions/$sessionId/review' params={{ sessionId }}>
        <Layers className='size-4' />
        {t`Cards`}
      </Link>
    </Button>
  )

  return (
    <ModalScreen onClose={close} title={thread?.title ?? (isLoading ? '' : t`Chat`)} rightSlot={cardsLink}>
      <ChatBody
        sessionId={sessionId}
        messages={thread?.messages ?? null}
        isLoading={isLoading}
        pendingContent={pendingContent}
        isPending={isPending}
        emptyHint={null}
      />
      <Composer
        value={draft}
        onChange={setDraft}
        onSend={handleSend}
        disabled={isPending || !thread}
        placeholder={t`Ask anything, or "add these"`}
      />
    </ModalScreen>
  )
}

// A new thread: pick the language, send the first message. The thread (and
// its session) is created with that first message.
export const NewVocabChatView = ({ language, message }: { language?: string; message?: string }) => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const close = useModalScreenClose({ to: '/vocabulary/new-word' })
  const { data: prefs } = useGetUserPrefs()
  const { mutate: setCefr, isPending: isSettingCefr } = useSetCefrForLanguage()
  const { mutate: startChat, isPending } = useStartVocabChat()
  const showSendError = useSendErrorToast()

  const cefrSetLanguages = useMemo(
    () => (prefs?.targetLanguagePrefs ?? []).map((p) => p.targetLanguage).sort(),
    [prefs]
  )
  const [pickedLanguage, setPickedLanguage] = useState<string | null>(null)
  const targetLanguage = pickedLanguage ?? language ?? prefs?.lastTargetLanguage ?? cefrSetLanguages[0] ?? null
  const requiresCefr = !!prefs && !!targetLanguage && !cefrSetLanguages.includes(targetLanguage)
  const [cefrChoice, setCefrChoice] = useState<CefrLevel | null>(null)
  const [draft, setDraft] = useState(message ?? '')
  const [pendingContent, setPendingContent] = useState<string | null>(null)

  const handleSend = () => {
    const content = draft.trim()
    if (!content || !targetLanguage || isPending) return
    setPendingContent(content)
    setDraft('')
    startChat(
      { targetLanguage, content },
      {
        onSuccess: (response) => {
          const { sessionId, title, userMessage, assistantMessage } = response.data
          // Seed the thread cache so the thread view renders without a
          // loading flash; the replace keeps "back" from reopening this
          // blank composer.
          queryClient.setQueryData(orpcQuery.vocabChat.getThread.queryKey({ input: { sessionId } }), {
            data: { sessionId, title, targetLanguage, messages: [userMessage, assistantMessage] },
          })
          void navigate({ to: '/chat/$sessionId', params: { sessionId }, replace: true })
        },
        onError: (err) => {
          setDraft(content)
          setPendingContent(null)
          showSendError(err)
        },
      }
    )
  }

  const languageName = targetLanguage ? getLanguageName(targetLanguage) : ''

  return (
    <ModalScreen onClose={close} title={t`New chat`}>
      {requiresCefr && targetLanguage ? (
        <div className='flex-1 overflow-y-auto'>
          <div className='mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-4 md:max-w-lg'>
            <CefrStep targetLanguage={targetLanguage} value={cefrChoice} onChange={setCefrChoice} />
            <Button
              size='xl'
              className='w-full'
              disabled={!cefrChoice || isSettingCefr}
              onClick={() => cefrChoice && setCefr({ targetLanguage, cefrLevel: cefrChoice })}
            >
              {isSettingCefr ? t`Saving…` : t`Continue`}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <ChatBody
            sessionId={null}
            messages={[]}
            isLoading={false}
            pendingContent={pendingContent}
            isPending={isPending}
            emptyHint={
              <div className='flex flex-col gap-4'>
                <LanguageSelectField
                  label={t`Language`}
                  value={targetLanguage}
                  placeholder={t`Pick a language`}
                  pinnedCode={prefs?.lastTargetLanguage ?? undefined}
                  onChange={setPickedLanguage}
                />
                <p className='text-muted-foreground text-sm'>
                  {t`Ask how to say something, or for words on a topic ("gym vocabulary"). Useful terms show up as a checklist you can add as cards. The chat is saved with its cards in your sessions.`}
                </p>
              </div>
            }
          />
          <Composer
            value={draft}
            onChange={setDraft}
            onSend={handleSend}
            disabled={isPending || !targetLanguage}
            placeholder={languageName ? t`Ask about ${languageName}…` : t`Ask anything…`}
          />
        </>
      )}
    </ModalScreen>
  )
}

const ChatBody = ({
  sessionId,
  messages,
  isLoading,
  pendingContent,
  isPending,
  emptyHint,
}: {
  sessionId: string | null
  messages: VocabChatMessage[] | null
  isLoading: boolean
  pendingContent: string | null
  isPending: boolean
  emptyHint: React.ReactNode
}) => {
  const { t } = useLingui()
  const listRef = useRef<HTMLDivElement>(null)
  const lastReplyRef = useRef<HTMLDivElement>(null)
  const seenReplyId = useRef<string | undefined>(undefined)
  const lastAssistantId = messages?.reduce<string | undefined>(
    (acc, m) => (m.role === 'assistant' ? m.id : acc),
    undefined
  )

  // Opening a thread lands on the latest turn; a reply that arrives while open
  // is anchored at its top so reading starts at its beginning; a send follows
  // to the bottom.
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el || !messages) return
    const isFirstRender = seenReplyId.current === undefined
    const isNewReply = !!lastAssistantId && lastAssistantId !== seenReplyId.current
    seenReplyId.current = lastAssistantId ?? ''
    if (!isFirstRender && isNewReply && lastReplyRef.current) {
      lastReplyRef.current.scrollIntoView({ block: 'start' })
      return
    }
    el.scrollTop = el.scrollHeight
  }, [messages, lastAssistantId, pendingContent])

  return (
    <div ref={listRef} className='min-h-0 flex-1 overflow-y-auto'>
      <div className='mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 py-4'>
        {isLoading && (
          <>
            <Skeleton className='h-10 w-2/3 self-end' />
            <Skeleton className='h-24 w-5/6' />
          </>
        )}
        {!isLoading && (messages?.length ?? 0) === 0 && !pendingContent && emptyHint}
        {messages?.map((m) =>
          m.role === 'user' ? (
            <UserBubble key={m.id} content={m.content} />
          ) : (
            <div
              key={m.id}
              ref={m.id === lastAssistantId ? lastReplyRef : undefined}
              className='flex scroll-mt-4 flex-col gap-2'
            >
              {m.content && <MarkdownMessage content={m.content} className='text-sm' />}
              {m.proposal && sessionId && (
                <ProposalChecklist sessionId={sessionId} messageId={m.id} items={m.proposal.items} />
              )}
              {m.newThreadSuggestion && <NewThreadNotice suggestion={m.newThreadSuggestion} />}
            </div>
          )
        )}
        {pendingContent && <UserBubble content={pendingContent} pending />}
        {isPending && (
          <div className='text-muted-foreground flex items-center gap-2 text-sm'>
            <Loader2 className='size-4 animate-spin' />
            {t`Thinking…`}
          </div>
        )}
      </div>
    </div>
  )
}

const UserBubble = ({ content, pending = false }: { content: string; pending?: boolean }) => (
  <div
    className={cn(
      'max-w-[85%] self-end rounded-2xl bg-blue-100 px-3 py-2 text-sm whitespace-pre-wrap dark:bg-blue-400/20',
      pending && 'opacity-70'
    )}
  >
    {content}
  </div>
)

type ProposalItem = NonNullable<VocabChatMessage['proposal']>['items'][number]

// The model's propose_cards output: tick what to keep, add in one tap. Terms
// already in the learner's vocabulary start unticked.
const ProposalChecklist = ({
  sessionId,
  messageId,
  items,
}: {
  sessionId: string
  messageId: string
  items: ProposalItem[]
}) => {
  const { t } = useLingui()
  const { mutate: addItems, isPending } = useAddProposedItems(sessionId)
  const [unchecked, setUnchecked] = useState<Set<number>>(
    () => new Set(items.flatMap((item, i) => (item.inVocabulary ? [i] : [])))
  )
  const selectable = items.flatMap((item, i) => (!item.added && !unchecked.has(i) ? [i] : []))
  const selectedCount = selectable.length
  const allAdded = items.every((item) => item.added)

  const toggle = (index: number) =>
    setUnchecked((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })

  return (
    <div className='bg-card flex flex-col overflow-hidden rounded-xl border'>
      <ul className='flex flex-col divide-y'>
        {items.map((item, index) => {
          const checked = item.added || !unchecked.has(index)
          return (
            <li key={`${index}-${item.headword}`}>
              <button
                type='button'
                disabled={item.added || isPending}
                onClick={() => toggle(index)}
                className='hover:bg-accent active:bg-accent flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors disabled:hover:bg-transparent'
              >
                <span
                  className={cn(
                    'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border',
                    item.added && 'border-emerald-600 bg-emerald-600 text-white',
                    !item.added && checked && 'border-foreground bg-foreground text-background'
                  )}
                  aria-hidden
                >
                  {checked && <Check className='size-3.5' />}
                </span>
                <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
                  <span className='flex flex-wrap items-baseline gap-x-2'>
                    <span className='font-semibold'>{item.headword}</span>
                    {item.added && <span className='text-xs text-emerald-700 dark:text-emerald-400'>{t`Added`}</span>}
                    {!item.added && item.inVocabulary && (
                      <span className='text-muted-foreground text-xs'>{t`Already in your vocabulary`}</span>
                    )}
                  </span>
                  {item.note && <span className='text-muted-foreground text-sm'>{item.note}</span>}
                  {item.example && <span className='text-sm italic'>{item.example}</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {!allAdded && (
        <div className='border-t p-2'>
          <Button
            size='sm'
            className='w-full'
            disabled={selectedCount === 0 || isPending}
            onClick={() => addItems({ sessionId, messageId, itemIndexes: selectable })}
          >
            {isPending && <Loader2 className='size-4 animate-spin' />}
            {t`Add ${selectedCount} as cards`}
          </Button>
        </div>
      )}
    </div>
  )
}

// The learner asked about another target language: a thread keeps one
// language, so offer a new thread with their message carried over.
const NewThreadNotice = ({ suggestion }: { suggestion: { language: string; message: string } }) => {
  const { t } = useLingui()
  const languageName = getLanguageName(suggestion.language)
  return (
    <div className='bg-accent/40 flex flex-col gap-2 rounded-xl border p-3 text-sm'>
      <span className='text-muted-foreground'>{t`This chat is for one language.`}</span>
      <Button variant='outline' size='sm' className='self-start' asChild>
        <Link to='/chat/new' search={{ language: suggestion.language, message: suggestion.message }}>
          {t`Continue in a new ${languageName} chat`}
          <ArrowRight className='size-4' />
        </Link>
      </Button>
    </div>
  )
}

const Composer = ({
  value,
  onChange,
  onSend,
  disabled,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  disabled: boolean
  placeholder: string
}) => {
  const { t } = useLingui()
  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter inserts a newline. Ignore Enter during an IME
    // composition so picking a candidate doesn't send.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      onSend()
    }
  }
  return (
    <div className='bg-background pb-safe shrink-0 border-t px-4 pt-3'>
      <div className='mx-auto flex w-full max-w-2xl items-end gap-2'>
        <Textarea
          value={value}
          maxLength={MESSAGE_MAX}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          className='max-h-40 min-h-11 text-base'
          rows={1}
          enterKeyHint='send'
          placeholder={placeholder}
          autoFocus
        />
        <Button
          onClick={onSend}
          disabled={disabled || !value.trim()}
          size='icon'
          className='size-11 shrink-0'
          aria-label={t`Send`}
        >
          <Send className='size-4' />
        </Button>
      </div>
    </div>
  )
}

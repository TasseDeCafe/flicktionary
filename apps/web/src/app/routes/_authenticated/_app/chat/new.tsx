import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { NewVocabChatView } from '@/features/vocab-chat/components/vocab-chat-view'

// `language` preselects the thread's target language; `message` prefills the
// composer (a query carried over from "Translate & add", or the request the
// model redirected from a thread in another language). `seedQ`/`seedCtx` name
// a "Translate & add" search whose results open the thread.
const newChatSearchSchema = z.object({
  language: z.string().optional().catch(undefined),
  message: z.string().max(4000).optional().catch(undefined),
  seedQ: z.string().max(500).optional().catch(undefined),
  seedCtx: z.string().max(2000).optional().catch(undefined),
})

const NewChatRoute = () => {
  const { language, message, seedQ, seedCtx } = Route.useSearch()
  // Keyed so following a "new chat in another language" link from one new-chat
  // screen to another resets the composer.
  return (
    <NewVocabChatView
      key={`${language}-${message}-${seedQ}-${seedCtx}`}
      language={language}
      message={message}
      seedQuery={seedQ}
      seedContext={seedCtx}
    />
  )
}

export const Route = createFileRoute('/_authenticated/_app/chat/new')({
  validateSearch: newChatSearchSchema,
  component: NewChatRoute,
  staticData: { hideAppChrome: true },
})

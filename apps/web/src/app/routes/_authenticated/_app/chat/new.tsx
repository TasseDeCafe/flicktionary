import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { NewVocabChatView } from '@/features/vocab-chat/components/vocab-chat-view'

// `language` preselects the thread's target language; `message` prefills the
// composer (the query carried over from "Translate & add", or the request the
// model redirected from a thread in another language).
const newChatSearchSchema = z.object({
  language: z.string().optional().catch(undefined),
  message: z.string().max(4000).optional().catch(undefined),
})

const NewChatRoute = () => {
  const { language, message } = Route.useSearch()
  // Keyed so following a "new chat in another language" link from one new-chat
  // screen to another resets the composer.
  return <NewVocabChatView key={`${language}-${message}`} language={language} message={message} />
}

export const Route = createFileRoute('/_authenticated/_app/chat/new')({
  validateSearch: newChatSearchSchema,
  component: NewChatRoute,
  staticData: { hideAppChrome: true },
})

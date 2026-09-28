import { createFileRoute } from '@tanstack/react-router'
import { VocabChatThreadView } from '@/features/vocab-chat/components/vocab-chat-view'

const ChatThreadRoute = () => {
  const { sessionId } = Route.useParams()
  return <VocabChatThreadView key={sessionId} sessionId={sessionId} />
}

export const Route = createFileRoute('/_authenticated/_app/chat/$sessionId')({
  component: ChatThreadRoute,
  staticData: { hideAppChrome: true },
})

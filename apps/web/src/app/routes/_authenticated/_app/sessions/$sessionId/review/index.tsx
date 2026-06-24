import { createFileRoute } from '@tanstack/react-router'
import { SessionVocabularyView } from '@/features/review/components/session-vocabulary-view'

export const Route = createFileRoute('/_authenticated/_app/sessions/$sessionId/review/')({
  component: SessionVocabularyView,
  staticData: { hideAppChrome: true },
})

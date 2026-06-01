import { createFileRoute } from '@tanstack/react-router'
import { FlashcardSessionView } from '@/features/practice/components/flashcard-session-view'

export const Route = createFileRoute('/_authenticated/_app/practice/flashcards/$targetLanguage')({
  component: FlashcardSessionView,
  staticData: { hideAppChrome: true },
})

import { createFileRoute } from '@tanstack/react-router'
import { PracticeLanguageView } from '@/features/practice/components/practice-language-view'

export const Route = createFileRoute('/_authenticated/_app/practice/language/$targetLanguage')({
  component: PracticeLanguageView,
})

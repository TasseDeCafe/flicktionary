import { createFileRoute } from '@tanstack/react-router'
import { VocabularyListView } from '@/features/vocabulary/components/vocabulary-list-view'

export const Route = createFileRoute('/_authenticated/_app/vocabulary/')({
  component: VocabularyListView,
})

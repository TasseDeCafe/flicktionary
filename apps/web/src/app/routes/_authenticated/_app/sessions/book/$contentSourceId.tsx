import { createFileRoute } from '@tanstack/react-router'
import { BookDetailView } from '@/features/books/components/book-detail-view'

export const Route = createFileRoute('/_authenticated/_app/sessions/book/$contentSourceId')({
  component: BookDetailView,
  staticData: { hideAppChrome: true },
})

import { createFileRoute } from '@tanstack/react-router'
import { ProcessingView } from '@/features/review/components/processing-view'

export const Route = createFileRoute('/_authenticated/_app/sessions/$sessionId/processing')({
  component: ProcessingView,
  staticData: { hideAppChrome: true },
})

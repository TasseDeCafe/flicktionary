import { createFileRoute } from '@tanstack/react-router'
import { FocusView } from '@/features/review/components/focus-view'

export const Route = createFileRoute('/_authenticated/_app/sessions/$sessionId/review/$cardId')({
  component: FocusView,
  staticData: { hideAppChrome: true },
})

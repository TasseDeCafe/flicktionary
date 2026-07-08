import { createFileRoute } from '@tanstack/react-router'
import { LessonImportConfirmView } from '@/features/lesson-import/components/lesson-import-confirm-view'

export const Route = createFileRoute('/_authenticated/_app/lessons/import/$batchId')({
  component: LessonImportConfirmView,
  staticData: { hideAppChrome: true },
})

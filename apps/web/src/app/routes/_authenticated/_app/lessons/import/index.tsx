import { createFileRoute } from '@tanstack/react-router'
import { LessonImportWizard } from '@/features/lesson-import/components/lesson-import-wizard'

export const Route = createFileRoute('/_authenticated/_app/lessons/import/')({
  component: LessonImportWizard,
  staticData: { hideAppChrome: true },
})

import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { PracticeStartView } from '@/features/practice/components/practice-start-view'

const practiceStartSearchSchema = z.object({
  lang: z.string().min(1),
})

export const Route = createFileRoute('/_authenticated/_app/practice/start')({
  validateSearch: practiceStartSearchSchema,
  component: PracticeStartView,
  staticData: { hideAppChrome: true },
})

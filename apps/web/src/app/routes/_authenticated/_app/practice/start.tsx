import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { PracticeStartView } from '@/features/practice/components/practice-start-view'

const practiceStartSearchSchema = z.object({
  lang: z.string().min(1),
  mode: z.enum(['review_due', 'learn_new', 'learn_extra', 'mixed']).default('review_due'),
})

export const Route = createFileRoute('/_authenticated/_app/practice/start')({
  validateSearch: practiceStartSearchSchema,
  component: PracticeStartView,
  staticData: { hideAppChrome: true },
})

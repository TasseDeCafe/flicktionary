import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ReadingHistoryView } from '@/features/practice/components/reading-history-view'

const historySearchSchema = z.object({
  pool: z.enum(['recognition', 'production']).catch('recognition'),
})

export const Route = createFileRoute('/_authenticated/_app/practice/history/$targetLanguage')({
  validateSearch: historySearchSchema,
  component: ReadingHistoryView,
  staticData: { hideAppChrome: true },
})

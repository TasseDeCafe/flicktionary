import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { StrengthenView } from '@/features/practice/components/strengthen-view'

// `sessionHard` carries the just-finished flashcard session's again/hard
// userLookupIds as search params so the list survives a refresh. The server
// re-validates ownership — these ids are never trusted as-is.
const strengthenSearchSchema = z.object({
  pool: z.enum(['recognition', 'production']).catch('recognition'),
  sessionHard: z.array(z.string().uuid()).optional(),
})

export const Route = createFileRoute('/_authenticated/_app/practice/strengthen/$targetLanguage')({
  validateSearch: strengthenSearchSchema,
  component: StrengthenView,
  staticData: { hideAppChrome: true },
})

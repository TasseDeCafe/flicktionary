import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { SessionRecapView } from '@/features/practice/components/session-recap-view'

// `studySessionId` scopes the recap to one session's kept terms. The quiz is
// built entirely client-side from the session's card list — no SRS writes.
const recapSearchSchema = z.object({
  studySessionId: z.string().uuid(),
})

export const Route = createFileRoute('/_authenticated/_app/practice/recap/$targetLanguage')({
  validateSearch: recapSearchSchema,
  component: SessionRecapView,
  staticData: { hideAppChrome: true },
})

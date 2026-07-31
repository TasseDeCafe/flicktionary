import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { SaveProgressView } from '@/features/auth/components/save-progress-view'

const saveProgressSearchSchema = z.object({
  // Stamped on the linkIdentity redirect back from Google. OAuth error params
  // ride along outside the schema and are read from location directly.
  linked: z.literal('google').optional().catch(undefined),
})

export const Route = createFileRoute('/_authenticated/_app/save-progress')({
  validateSearch: saveProgressSearchSchema,
  component: SaveProgressView,
  staticData: { hideAppChrome: true },
})

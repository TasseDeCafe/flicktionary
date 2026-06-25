import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { NewSessionWizard } from '@/features/sessions/components/new-session-wizard'

// Optional seed for the "Add episode" shortcut: jump straight into the TV
// episode picker for an already-watched show instead of walking the whole
// wizard. All three must be present to seed; otherwise the wizard starts fresh.
const searchSchema = z.object({
  tmdbShowId: z.number().int().optional(),
  tgt: z.string().optional(),
  season: z.number().int().optional(),
})

export const Route = createFileRoute('/_authenticated/_app/sessions/new')({
  component: NewSessionWizard,
  validateSearch: searchSchema,
  staticData: { hideAppChrome: true },
})

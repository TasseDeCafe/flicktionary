import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ExtensionPairView } from '@/features/extension-pair/components/extension-pair-view'

const extensionPairSearchSchema = z.object({
  nonce: z.string().uuid(),
})

export const Route = createFileRoute('/_authenticated/extension-pair')({
  validateSearch: extensionPairSearchSchema,
  component: ExtensionPairView,
})

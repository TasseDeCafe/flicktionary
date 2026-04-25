import { createFileRoute } from '@tanstack/react-router'
import { FreeTrialExplanationView } from '@/features/billing/components/free-trial-explanation-view.tsx'
import { z } from 'zod'
import { PLAN_INTERVALS } from '@template-app/core/constants/pricing-constants'

const freeTrialExplanationSearchSchema = z.object({
  planInterval: z.enum(PLAN_INTERVALS),
})

export const Route = createFileRoute('/_authenticated/pricing/free-trial-explanation')({
  validateSearch: freeTrialExplanationSearchSchema,
  component: FreeTrialExplanationView,
})

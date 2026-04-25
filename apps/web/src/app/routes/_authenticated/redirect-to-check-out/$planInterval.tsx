import { createFileRoute } from '@tanstack/react-router'
import { RedirectToCheckOut } from '@/features/checkout/components/redirect-to-checkout.tsx'
import { z } from 'zod'
import { PLAN_INTERVALS } from '@template-app/core/constants/pricing-constants'

const planIntervalParamsSchema = z.object({
  planInterval: z.enum(PLAN_INTERVALS),
})

export const Route = createFileRoute('/_authenticated/redirect-to-check-out/$planInterval')({
  params: {
    parse: (params) => planIntervalParamsSchema.parse(params),
  },
  component: RedirectToCheckOut,
})

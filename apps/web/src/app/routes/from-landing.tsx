import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { PLAN_INTERVALS } from '@template-app/core/constants/pricing-constants'
import { Route as dashboardRoute } from '@/app/routes/_authenticated/_tabs/dashboard'
import { Route as redirectToCheckoutRoute } from '@/app/routes/_authenticated/redirect-to-check-out/$planInterval'

const fromLandingSearchSchema = z.object({
  planInterval: z.enum(PLAN_INTERVALS).optional(),
})

export const Route = createFileRoute('/from-landing')({
  validateSearch: fromLandingSearchSchema,
  beforeLoad: ({ search }) => {
    if (search.planInterval) {
      throw redirect({
        to: redirectToCheckoutRoute.to,
        params: { planInterval: search.planInterval },
      })
    }
    throw redirect({ to: dashboardRoute.to })
  },
})

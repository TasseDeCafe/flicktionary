import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'

// Per-day study activity for the dashboard/stats charts. Days are server
// (UTC) calendar days — the same CURRENT_DATE boundary every practice budget
// uses — so the bars agree with the daily-new counters.

const LanguageActivitySchema = z.object({
  targetLanguage: z.string(),
  // Aligned to the response's `days`: newTerms[i] is the count on days[i].
  newTerms: z.array(z.number().int()),
  markedKnown: z.array(z.number().int()),
  // Live ratings + answered exercises. Introductions count here AND in
  // newTerms (deliberate overlap — the charts are separate small multiples).
  // Implicit checkpoint reading credits are excluded (bulk byproducts of
  // reading); explicit per-term "I know this" assertions are included.
  practiced: z.array(z.number().int()),
})

export type LanguageActivity = z.infer<typeof LanguageActivitySchema>

export const statsContract = {
  getActivity: oc
    .route({ method: 'GET', path: '/stats/activity', successStatus: 200 })
    .errors({
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({}))
    .output(
      z.object({
        data: z.object({
          // ISO dates (YYYY-MM-DD), oldest → newest, ending on the server's
          // current day.
          days: z.array(z.string()),
          perLanguage: z.array(LanguageActivitySchema),
          // Consecutive active days ending today — or yesterday when today has
          // no activity yet (a streak only breaks once the day is over).
          // Active = introduced a term, rated a card (incl. checkpoint reading
          // credits), answered an exercise, or marked lemmas known. Merely
          // opening a session does not count.
          streakDays: z.number().int(),
          // Every active day ever (same definition as the streak), newest
          // first — the calendar's fill data. Inherently bounded by signup.
          activeDays: z.array(z.string()),
          // Server-UTC day the account was created — the calendar's back
          // clamp and the pre-signup bare-numeral boundary.
          joinedDay: z.string(),
        }),
      })
    ),
}

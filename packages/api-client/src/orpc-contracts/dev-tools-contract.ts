import { oc } from '@orpc/contract'
import { z } from 'zod'

export const DEV_TOOLS_ADVANCE_PRACTICE_CLOCK_PATH = '/dev-tools/advance-practice-clock' as const

// Test-user-only tooling (gated server-side on EMAILS_OF_TEST_USERS).
// advancePracticeClock shifts the caller's own practice timestamps back by
// `days`, which is equivalent to the server clock advancing that many days —
// the in-UI time travel for exercising multi-day flows (warm-up / leech-rehab
// graduation, daily-new cap resets) without waiting real days.
export const devToolsContract = {
  advancePracticeClock: oc
    .route({
      method: 'POST',
      path: DEV_TOOLS_ADVANCE_PRACTICE_CLOCK_PATH,
      successStatus: 200,
    })
    .input(
      z.object({
        days: z.number().int().min(1).max(30),
      })
    )
    .output(
      z.object({
        data: z.object({
          tables: z.array(
            z.object({
              table: z.string(),
              rowsShifted: z.number(),
            })
          ),
        }),
      })
    ),
} as const

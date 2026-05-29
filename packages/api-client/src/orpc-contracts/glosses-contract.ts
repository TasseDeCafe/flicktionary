import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'
import { GrammarIpaBagSchema } from './common/flicktionary-schemas'

export const glossesContract = {
  // Stateless gloss for an arbitrary selection in its sentence context. Re-uses
  // the same Haiku prompt as highlights.fastGloss / practice.fastGloss, but is
  // not tied to a highlight or practice_text and creates NO rows — built for
  // transient lookups like the browser extension's subtitle hover. Native
  // language and hide-translation mode are resolved from the caller's prefs
  // server-side. No persistence; callers cache client-side.
  fastGloss: oc
    .route({ method: 'POST', path: '/glosses/fast-gloss', successStatus: 200 })
    .errors({
      BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        selectionText: z.string().trim().min(1).max(200),
        contextLine: z.string().trim().min(1).max(2000),
        targetLanguage: z.string().trim().min(1).max(40),
      })
    )
    .output(
      z.object({
        data: z.object({
          gloss: z.string(),
          pos: z.string().nullable(),
          register: z.string().nullable(),
          ipa: GrammarIpaBagSchema.nullable(),
        }),
      })
    ),
}

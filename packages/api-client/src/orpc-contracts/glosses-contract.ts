import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'
import { GrammarIpaBagSchema } from './common/flicktionary-schemas'

export const glossesContract = {
  // Stateless gloss for an arbitrary selection in its sentence context. Re-uses
  // the same Haiku prompt as highlights.fastGloss, but is not tied to a
  // highlight and creates NO rows — built for transient lookups like the
  // browser extension's subtitle hover or the web practice LookupSheet. Native
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
        // Optional: the language of the text. When omitted (e.g. the extension
        // hasn't registered the video's session yet, so it doesn't know the
        // subtitle language), the server detects it from `contextLine`. The
        // gloss must never depend on the user's *primary* target language —
        // the target IS the language of the text being glossed.
        targetLanguage: z.string().trim().min(1).max(40).optional(),
      })
    )
    .output(
      z.object({
        data: z.object({
          gloss: z.string(),
          pos: z.string().nullable(),
          register: z.string().nullable(),
          ipa: GrammarIpaBagSchema.nullable(),
          // Server-picked, dialect-correct display string (the user's
          // english_ipa_dialect pref for English, untagged otherwise) so
          // clients render it verbatim instead of re-picking from the bag.
          // The bag stays for deployed clients that still pick client-side.
          ipaDisplay: z.string().nullable(),
          // The lemma the IPA was sourced from when the surface form has no
          // pronunciation of its own and we fell back to its lemma's (e.g.
          // "beheben" under a "behoben" selection). Null when the IPA belongs
          // to the surface form itself; clients label it so the inflected form
          // is not implied to be pronounced this way.
          ipaLemma: z.string().nullable(),
        }),
      })
    ),
}

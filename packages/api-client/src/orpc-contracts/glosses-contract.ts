import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'
import { GrammarIpaBagSchema } from './common/flicktionary-schemas'

// The reader's word-family line (docs/proposals/word-family-hints.md): how the
// selection is built and which of its relatives the user already has.
export const WordFamilySchema = z.object({
  // Set when the selection is a participle / gerund / passive / verbal noun
  // of `lemma` (a dictionary spelling).
  formOf: z
    .object({
      kind: z.enum(['participle', 'adverbial_participle', 'gerund', 'passive', 'verbal_noun']),
      lemma: z.string(),
    })
    .nullable(),
  // The breakdown in order (за- + мёрзнуть); a single non-affix part means
  // "derived from". The generated insight's breakdown when there is one
  // (with what each part contributes in this word), kaikki's otherwise
  // (meanings null). Null when there is none.
  parts: z.array(z.object({ text: z.string(), isAffix: z.boolean(), meaning: z.string().nullable() })).nullable(),
  // Up to 3 relatives from the user's vocabulary, best first (parent, shared
  // root, related; known before saved; frequent first). Non-empty on the
  // fastGloss response → the reader holds the translation back behind a
  // reveal. The insight can drop links a learner can't see and add parents
  // kaikki lacks.
  anchors: z.array(z.object({ lemma: z.string(), source: z.enum(['known', 'saved']) })),
  // Obviously related words in the reader's native language (дюжина ≈ dozen).
  cognates: z.array(z.string()),
  // The lemma's insight isn't generated yet for the reader's language: the
  // client calls glosses.wordFamilyInsight to fill the line in.
  insightPending: z.boolean(),
})
export type WordFamily = z.infer<typeof WordFamilySchema>

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
        // Only the web reader's gloss sheet asks for the word-family line;
        // hovers and other lookups skip its queries.
        includeWordFamily: z.boolean().optional(),
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
          // Candidate lemmas of the selection the user has marked known
          // (folded strings). Empty → no "Marked as known" chip. Un-marking
          // sends these back verbatim to studySessions.unmarkKnownLemma.
          knownLemmaCandidates: z.array(z.string()),
          // Null unless requested (includeWordFamily), enabled for the
          // language (word_family_hints_enabled + a word-family language),
          // and there is an informative structure or an anchor to show.
          wordFamily: WordFamilySchema.nullable(),
        }),
      })
    ),

  // The word-family line with its LLM insight (generated and cached on first
  // request, for every user). Same input as the fastGloss call it follows —
  // `pos` is that gloss's POS — so the server resolves the same word. The
  // reader swaps its line for this one; the translation hold stays as the
  // fastGloss response decided it. Null when the word has no line.
  wordFamilyInsight: oc
    .route({ method: 'POST', path: '/glosses/word-family-insight', successStatus: 200 })
    .errors({
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        selectionText: z.string().trim().min(1).max(200),
        targetLanguage: z.string().trim().min(1).max(40),
        pos: z.string().nullable(),
      })
    )
    .output(
      z.object({
        data: z.object({
          wordFamily: WordFamilySchema.nullable(),
        }),
      })
    ),

  // Records an EXPLICIT lookup (a tap that opens the gloss sheet, a pinned
  // extension hover gloss — never a bare hover, which calls fastGloss on a
  // debounce) as a new-term demand signal: repeated lookups of a word lift it
  // to the "revealed demand" priority tier. Fire-and-forget; single-word
  // selections in languages with wiktionary data only, anything else is a
  // no-op. Returns the folded lemmas recorded (empty = nothing recorded).
  recordLookup: oc
    .route({ method: 'POST', path: '/glosses/record-lookup', successStatus: 200 })
    .errors({
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        selectionText: z.string().trim().min(1).max(200),
        targetLanguage: z.string().trim().min(1).max(40),
      })
    )
    .output(
      z.object({
        data: z.object({
          lemmas: z.array(z.string()),
        }),
      })
    ),
}

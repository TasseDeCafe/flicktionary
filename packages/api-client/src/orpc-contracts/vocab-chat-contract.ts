import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'
import { FacetSkillSchema } from './common/flicktionary-schemas'

// "Translate & add" (fast lane) and the vocabulary chat (slow lane). Both are
// signed-in only: guests are rejected with FORBIDDEN / code GUEST_NOT_ALLOWED.

export const CaptureCandidateSchema = z.object({
  headword: z.string(),
  note: z.string(),
  example: z.string(),
})
export type CaptureCandidate = z.infer<typeof CaptureCandidateSchema>

// One card of a matched term, as a capture search row and its info sheet show
// it. `dueInDays` counts from the server's today (0 or less: due today).
export const CaptureFacetStatusSchema = z.object({
  skill: FacetSkillSchema,
  targetForm: z.string(),
  srsState: z.enum(['new', 'learning', 'review', 'relearning']).nullable(),
  dueInDays: z.number().int().nullable(),
  enabled: z.boolean(),
  // Has its own schedule: re-enabling it resumes that schedule.
  hasHistory: z.boolean(),
  parked: z.boolean(),
  dataReady: z.boolean(),
  // "Review tomorrow": active until the card's next review; boostable when it
  // is in review and due after tomorrow; undoable while the boost is untouched.
  boostActive: z.boolean(),
  boostable: z.boolean(),
  boostUndoable: z.boolean(),
  // The due date an active boost replaced.
  boostPrevDue: z.string().nullable(),
})
export type CaptureFacetStatus = z.infer<typeof CaptureFacetStatusSchema>

export const CaptureTermStatusSchema = z.object({
  // Never introduced in any card.
  notStarted: z.boolean(),
  facets: z.array(CaptureFacetStatusSchema),
  // Today's latest capture demand for the term: whether it moved the term up
  // (counted), was undone (reverted), and can still be undone.
  demand: z.object({ counted: z.boolean(), reverted: z.boolean(), undoable: z.boolean() }).nullable(),
})
export type CaptureTermStatus = z.infer<typeof CaptureTermStatusSchema>

// Whether the learner already has a candidate, by meaning (a saved homograph
// with another meaning doesn't count).
export const CaptureMatchSchema = z.object({
  // The saved term with this candidate's meaning, else null.
  existingCard: z
    .object({ userLookupId: z.string().uuid(), cardId: z.string().uuid(), sessionId: z.string().uuid() })
    .nullable(),
  // When there's no match: the saved meanings of the same headword, if any.
  otherSenses: z.array(z.string()),
  // The matched term's cards and today's capture demand, else null.
  status: CaptureTermStatusSchema.nullable(),
})
export type CaptureMatch = z.infer<typeof CaptureMatchSchema>

export const VocabChatProposalItemSchema = z.object({
  headword: z.string(),
  note: z.string(),
  example: z.string(),
  // Already in the learner's vocabulary when proposed.
  inVocabulary: z.boolean(),
  // Added to the thread; the card is created by background enrichment.
  added: z.boolean(),
})
export type VocabChatProposalItem = z.infer<typeof VocabChatProposalItemSchema>

export const VocabChatMessageSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  proposal: z.object({ items: z.array(VocabChatProposalItemSchema) }).nullable(),
  // The learner asked about another target language: offer a new thread
  // seeded with `message`.
  newThreadSuggestion: z.object({ language: z.string(), message: z.string() }).nullable(),
  createdAt: z.string(),
})
export type VocabChatMessage = z.infer<typeof VocabChatMessageSchema>

const errorsWithPrefs = {
  BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
  FORBIDDEN: { status: 403, data: BackendErrorResponseSchema },
  NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
  UNPROCESSABLE_ENTITY: { status: 422, data: BackendErrorResponseSchema },
  TOO_MANY_REQUESTS: { status: 429, data: BackendErrorResponseSchema },
  INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
} as const

const MessageContentSchema = z.string().trim().min(1).max(4000)

// A "Translate & add" search carried into a new thread ("Ask about this"): it
// becomes the thread's opening exchange, the search as the learner's message
// and its candidates as the assistant's proposal.
const ThreadSeedSchema = z.object({
  userMessage: z.string().trim().min(1).max(3000),
  items: z
    .array(
      z.object({
        headword: z.string().trim().min(1).max(200),
        note: z.string().max(500),
        example: z.string().max(1000),
      })
    )
    .min(1)
    .max(3),
})

export const vocabChatContract = {
  // Fast lane: 1-3 target-language candidates for whatever the learner typed.
  // Adding a candidate goes through cards.createAdhoc.
  translate: oc
    .route({ method: 'POST', path: '/vocab-chat/translate', successStatus: 200 })
    .errors(errorsWithPrefs)
    .input(
      z.object({
        text: z.string().trim().min(1).max(500),
        targetLanguage: z.string().min(2).max(10),
        // Where the learner met the term (often partial, unedited, or long):
        // steers the sense and inspires each candidate's example.
        context: z.string().trim().min(1).max(2000).optional(),
      })
    )
    .output(
      z.object({
        data: z.object({
          inputLanguage: z.string().nullable(),
          candidates: z.array(CaptureCandidateSchema),
        }),
      })
    ),

  // Which translate candidates are already in the learner's vocabulary, one
  // match per candidate, in order. Separate from translate so it can be asked
  // fresh while the LLM candidates stay cached: vocabulary changes made
  // anywhere show up when the learner comes back to a search.
  captureMatches: oc
    .route({ method: 'POST', path: '/vocab-chat/capture-matches', successStatus: 200 })
    .errors(errorsWithPrefs)
    .input(
      z.object({
        targetLanguage: z.string().min(2).max(10),
        // The search text and translate's detected input language.
        text: z.string().trim().min(1).max(500),
        inputLanguage: z.string().nullable(),
        candidates: z
          .array(
            z.object({
              headword: z.string().trim().min(1).max(200),
              note: z.string().max(500),
              example: z.string().max(1000),
            })
          )
          .min(1)
          .max(10),
      })
    )
    .output(
      z.object({
        data: z.object({
          // The card the search tested: a native-language query means coming
          // up with the word (production), a target-language one recognizing
          // it.
          testedSkill: z.enum(['meaning_recognition', 'meaning_production']),
          matches: z.array(CaptureMatchSchema),
        }),
      })
    ),

  // Demand from a capture search for a saved, never-started term: moves it up
  // the new words. `search` (the top result) and `edit_card` count at most
  // once an hour per term; `move_up` is the explicit re-do after an undo.
  // `not_counted` when other demand in the last hour already covered it;
  // `skipped` when this term already had a capture event in the window.
  recordCaptureDemand: oc
    .route({ method: 'POST', path: '/vocab-chat/capture-demand', successStatus: 200 })
    .errors(errorsWithPrefs)
    .input(z.object({ userLookupId: z.string().uuid(), source: z.enum(['search', 'edit_card', 'move_up']) }))
    .output(
      z.object({
        data: z.object({ outcome: z.enum(['counted', 'not_counted', 'skipped', 'not_eligible']) }),
      })
    ),

  // Undo of the term's latest counted capture demand. `reverted: false` when
  // other demand arrived since (undoing would erase it too).
  undoCaptureDemand: oc
    .route({ method: 'POST', path: '/vocab-chat/capture-demand/undo', successStatus: 200 })
    .errors(errorsWithPrefs)
    .input(z.object({ userLookupId: z.string().uuid() }))
    .output(z.object({ data: z.object({ reverted: z.boolean() }) })),

  // Creates a thread (a 'chat' content source + study session) together with
  // its first message. BAD_REQUEST carries `cefr_not_set` /
  // `native_language_not_set` so the client can prompt inline.
  start: oc
    .route({ method: 'POST', path: '/vocab-chat/threads', successStatus: 201 })
    .errors(errorsWithPrefs)
    .input(
      z.object({
        targetLanguage: z.string().min(2).max(10),
        content: MessageContentSchema,
        seed: ThreadSeedSchema.optional(),
      })
    )
    .output(
      z.object({
        data: z.object({
          sessionId: z.string().uuid(),
          title: z.string(),
          // The whole new thread: the seeded exchange, if any, then the first
          // turn.
          messages: z.array(VocabChatMessageSchema),
        }),
      })
    ),

  getThread: oc
    .route({ method: 'GET', path: '/vocab-chat/threads/{sessionId}', successStatus: 200 })
    .errors(errorsWithPrefs)
    .input(z.object({ sessionId: z.string().uuid() }))
    .output(
      z.object({
        data: z.object({
          sessionId: z.string().uuid(),
          title: z.string(),
          targetLanguage: z.string(),
          messages: z.array(VocabChatMessageSchema),
        }),
      })
    ),

  sendMessage: oc
    .route({ method: 'POST', path: '/vocab-chat/threads/{sessionId}/messages', successStatus: 201 })
    .errors(errorsWithPrefs)
    .input(z.object({ sessionId: z.string().uuid(), content: MessageContentSchema }))
    .output(
      z.object({
        data: z.object({
          userMessage: VocabChatMessageSchema,
          assistantMessage: VocabChatMessageSchema,
          // Set when this turn (re)named the thread.
          title: z.string().nullable(),
        }),
      })
    ),

  // The checklist's Add button. Idempotent per item.
  addProposedItems: oc
    .route({
      method: 'POST',
      path: '/vocab-chat/threads/{sessionId}/messages/{messageId}/add',
      successStatus: 200,
    })
    .errors(errorsWithPrefs)
    .input(
      z.object({
        sessionId: z.string().uuid(),
        messageId: z.string().uuid(),
        itemIndexes: z.array(z.number().int().min(0)).min(1).max(50),
      })
    )
    .output(z.object({ data: z.object({ message: VocabChatMessageSchema }) })),
} as const

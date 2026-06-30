import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'
import {
  ExerciseAnswerSchema,
  FacetSkillSchema,
  GrammarIpaBagSchema,
  PracticeDueSummaryEntrySchema,
  PracticePoolSchema,
  PracticeRatingSchema,
  PracticeTextSchema,
  ReadingRatingSchema,
  ReviewScopeSchema,
  ReviewTermSchema,
  StrengthenExerciseEntrySchema,
} from './common/flicktionary-schemas'

export const practiceContract = {
  // Per-language summary used by the Practice landing. Returns one row per
  // target_language the user has cards in, with daily review, intraday
  // learning follow-up, new, and total counts (plus the production-pool
  // mirror).
  dueSummary: oc
    .route({ method: 'GET', path: '/practice/due-summary', successStatus: 200 })
    .errors({ INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema } })
    .input(z.object({}))
    .output(z.object({ data: z.object({ perLanguage: z.array(PracticeDueSummaryEntrySchema) }) })),

  // The live review pool for a (language, pool), sliced by scope. Feeds the
  // flashcard queue directly; the reading generator uses the same query for its
  // candidate set. Caps (daily-new remaining, max review) are applied
  // server-side from the user's practice limits. No session — closing and
  // reopening refetches a fresh slice (already-rated terms drop out naturally).
  listReviewTerms: oc
    .route({ method: 'GET', path: '/practice/review-terms', successStatus: 200 })
    .errors({
      BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        targetLanguage: z.string().min(1),
        pool: PracticePoolSchema.default('recognition'),
        scope: ReviewScopeSchema.default('mixed'),
        // Explicit learn-new batch size (learn_new scope only). When set, the
        // server serves exactly this many unseen terms regardless of the
        // remaining daily-new budget (Anki-style custom study). Ignored for
        // other scopes. GET query params arrive as strings, hence the coercion.
        newBatchSize: z.coerce.number().int().min(1).max(100).optional(),
      })
    )
    .output(z.object({ data: z.object({ terms: z.array(ReviewTermSchema) }) })),

  // Grade a single term in flashcard mode. Applies FSRS directly to the rated
  // facet's SRS state. New-term introductions (srs_state IS NULL) are gated by
  // an atomic daily-cap guard for the recognition pool; when the cap is
  // already consumed the intro is refused and the response carries
  // dailyCapReached=true (201, no FSRS applied) so the client drops the card.
  // Production-pool introductions are not daily-capped.
  rateTerm: oc
    .route({ method: 'POST', path: '/practice/review-terms/{userLookupId}/ratings', successStatus: 201 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        userLookupId: z.string().uuid(),
        rating: PracticeRatingSchema,
        pool: PracticePoolSchema.default('recognition'),
        // Facet identity of the rated card. `pool` names the session queue; the
        // queue can serve more than one facet per term, so identity rides
        // separately. Defaults preserve the citation-recognition card for any
        // client that doesn't yet send them.
        skill: FacetSkillSchema.default('meaning_recognition'),
        targetForm: z.string().default(''),
        // True when rating inside an explicit learn-new session: new-term
        // introductions bypass the daily-new cap (they still stamp
        // added_to_practice_at, so they count toward today's introductions).
        learnNewSession: z.boolean().optional(),
      })
    )
    .output(
      z.object({
        data: z.object({
          accepted: z.literal(true),
          introducedNew: z.boolean(),
          dailyCapReached: z.boolean(),
          // True when this rating crossed the leech threshold and parked the
          // term out of practice rotation (rehab gates are its way back).
          parked: z.boolean(),
          // Undo handle: the logged practice_rating_events row, passed back to
          // undoRating to revert this exact rating. Null when nothing was
          // applied (daily-cap refusal, or the parked stale-queue no-op) —
          // notably this disambiguates the two parked:true shapes: a rating
          // that newly parked a leech carries an eventId (fully undoable),
          // the stale no-op on an already-parked term does not.
          eventId: z.string().uuid().nullable(),
        }),
      })
    ),

  // Revert a previously applied rating (the "re-rate from history" flow's
  // first half — the client follows up with a fresh rateTerm). Restores the
  // pool's SRS columns from the event's pre-rating snapshot, clears the
  // daily-new stamp for an undone introduction, un-parks a leech the rating
  // parked, and tombstones the event (refunding the review budget). Only the
  // latest live event for (lookup, pool) can be reverted; a stale eventId
  // (a later rating landed meanwhile / already reverted) is a safe no-op:
  // undone=false, never an error.
  undoRating: oc
    .route({ method: 'POST', path: '/practice/review-terms/{userLookupId}/undo', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        userLookupId: z.string().uuid(),
        pool: PracticePoolSchema.default('recognition'),
        // Facet identity of the rating being reverted (matches the rateTerm
        // input). Defaults to the citation recognition card.
        skill: FacetSkillSchema.default('meaning_recognition'),
        targetForm: z.string().default(''),
        eventId: z.string().uuid(),
      })
    )
    .output(z.object({ data: z.object({ undone: z.boolean() }) })),

  // Bootstrap or resume reading mode for a (language, pool): returns the
  // in-progress 'reading' text if one exists, otherwise promotes a pre-generated
  // slot or generates a fresh one from the scope-filtered candidate set. done=true
  // when there is nothing left to review. Generation never introduces new terms —
  // that happens at rate/advance time only.
  generateNextReadingText: oc
    .route({ method: 'POST', path: '/practice/reading-texts/generate', successStatus: 200 })
    .errors({
      BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        targetLanguage: z.string().min(1),
        pool: PracticePoolSchema.default('recognition'),
        scope: ReviewScopeSchema.default('mixed'),
      })
    )
    .output(
      z.object({
        data: z.union([
          z.object({ done: z.literal(false), practiceText: PracticeTextSchema }),
          z.object({ done: z.literal(true) }),
        ]),
      })
    ),

  // Background pre-generation. Reserves the next slot if one is needed and kicks
  // off LLM work in a detached promise. `excludeUserLookupIds` carries the
  // currently-reading text's term ids so the pre-gen doesn't re-embed words that
  // are about to be rated by the pending advance. Returns the slot's current
  // status so the client can observe pre-gen progress if it cares.
  prepareNextReadingText: oc
    .route({ method: 'POST', path: '/practice/reading-texts/prepare', successStatus: 202 })
    .errors({
      BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        targetLanguage: z.string().min(1),
        pool: PracticePoolSchema.default('recognition'),
        scope: ReviewScopeSchema.default('mixed'),
        excludeUserLookupIds: z.array(z.string().uuid()).default([]),
      })
    )
    .output(
      z.object({
        data: z.union([
          z.object({ status: z.literal('queued'), practiceTextId: z.string().uuid() }),
          z.object({ status: z.literal('already_ready'), practiceTextId: z.string().uuid() }),
          z.object({ status: z.literal('already_generating'), practiceTextId: z.string().uuid() }),
          z.object({ status: z.literal('no_work') }),
        ]),
      })
    ),

  // The single reading-mode mutation. The client owns per-text rating state and
  // sends it all at once: `ratings` carries the explicit taps (by user_lookup
  // id), every other annotation is advanced as implicit 'good'. Idempotent via
  // the one-shot reading->done claim — a second call (double-click / retry)
  // applies no FSRS and returns the already-reserved next text. Returns done=true
  // when nothing else is left to review.
  advanceReadingText: oc
    .route({ method: 'POST', path: '/practice/reading-texts/{textId}/advance', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        textId: z.string().uuid(),
        pool: PracticePoolSchema.default('recognition'),
        scope: ReviewScopeSchema.default('mixed'),
        ratings: z.array(ReadingRatingSchema).default([]),
      })
    )
    .output(
      z.object({
        data: z.union([
          z.object({ done: z.literal(false), nextText: PracticeTextSchema, introduced: z.number().int() }),
          z.object({ done: z.literal(true), introduced: z.number().int() }),
        ]),
      })
    ),

  // Reading history: past generated texts for a (language, pool), newest first.
  // The texts double as history now that they're kept per (user, language, pool)
  // instead of being garbage-collected with the session.
  readingHistory: oc
    .route({ method: 'GET', path: '/practice/reading-texts/history', successStatus: 200 })
    .errors({
      BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        targetLanguage: z.string().min(1),
        pool: PracticePoolSchema.default('recognition'),
      })
    )
    .output(z.object({ data: z.object({ texts: z.array(PracticeTextSchema) }) })),

  // Read-only fetch of a single past text (history detail / peek-back).
  readingTextById: oc
    .route({ method: 'GET', path: '/practice/reading-texts/{textId}', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ textId: z.string().uuid() }))
    .output(z.object({ data: z.object({ practiceText: PracticeTextSchema }) })),

  // Build a Strengthen session: one gate exercise per parked (leech) term plus
  // one bonus exercise per this-session again/hard term. Server-side it
  // re-validates the client-supplied hard ids (ownership, language, pool) and
  // returns 'generating' placeholders for terms whose bank isn't warm yet —
  // never blocks on LLM work. Served payloads carry no answer fields.
  startStrengthenSession: oc
    .route({ method: 'POST', path: '/practice/strengthen/start', successStatus: 200 })
    .errors({
      BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        targetLanguage: z.string().min(1),
        pool: PracticePoolSchema.default('recognition'),
        sessionHardUserLookupIds: z.array(z.string().uuid()).max(100).default([]),
      })
    )
    .output(z.object({ data: z.object({ exercises: z.array(StrengthenExerciseEntrySchema) }) })),

  // Exercise-first warm-up: launched from the session-vocabulary screen. Parks
  // this session's not-yet-introduced kept terms into scaffolding (consuming the
  // daily new-term budget) and serves them gate exercises — the same rehab
  // ladder leeches use, entered from the opposite direction. Correct answers
  // graduate each term into the FSRS flashcard queue. dailyLimitReached=true
  // when the per-language new-term cap stopped further terms from entering.
  startWarmupSession: oc
    .route({ method: 'POST', path: '/practice/warmup/start', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        studySessionId: z.string().uuid(),
        targetLanguage: z.string().min(1),
      })
    )
    .output(
      z.object({
        data: z.object({
          exercises: z.array(StrengthenExerciseEntrySchema),
          dailyLimitReached: z.boolean(),
        }),
      })
    ),

  // Serve-only re-fetch of a warm-up session (NO parking / NO introductions),
  // safe to poll while exercises generate in the background. Re-serves the
  // session's currently onboarding-parked terms so the client can swap
  // 'generating' placeholders to 'ready'/'failed' in place.
  refreshWarmupSession: oc
    .route({ method: 'POST', path: '/practice/warmup/refresh', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        studySessionId: z.string().uuid(),
        targetLanguage: z.string().min(1),
      })
    )
    .output(z.object({ data: z.object({ exercises: z.array(StrengthenExerciseEntrySchema) }) })),

  // Language-scoped warm-up continuation (serve-only, safe to poll). Serves
  // every onboarding-parked term for the language so a user can resume an
  // abandoned warm-up from the Practice tab without a session. Leeches are
  // excluded — they have the Strengthen surface.
  continueWarmupSession: oc
    .route({ method: 'POST', path: '/practice/warmup/continue', successStatus: 200 })
    .errors({
      BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ targetLanguage: z.string().min(1), pool: PracticePoolSchema.default('recognition') }))
    .output(z.object({ data: z.object({ exercises: z.array(StrengthenExerciseEntrySchema) }) })),

  // Grade one exercise answer (server-side truth; the exercise is consumed on
  // answer, so a retry/stale submit is rejected). MC types take selectedIndex,
  // typed types take text. correctIndex / correctAnswer are revealed only in
  // the response — after the exercise has been consumed.
  submitExerciseAnswer: oc
    .route({ method: 'POST', path: '/practice/exercises/{exerciseId}/answer', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        exerciseId: z.string().uuid(),
        response: ExerciseAnswerSchema,
      })
    )
    .output(
      z.object({
        data: z.object({
          correct: z.boolean(),
          feedback: z.string().nullable(),
          gated: z.boolean(),
          correctIndex: z.number().int().nullable(),
          correctAnswer: z.string().nullable(),
          // Rehab progress after this answer. Non-null only for gate
          // exercises on a parked term: the distinct-day count so far, and
          // whether this answer graduated the term back into rotation.
          rehabCorrectDays: z.number().int().nullable(),
          graduated: z.boolean(),
        }),
      })
    ),

  // Selection-driven gloss for a practice text. Re-uses the same Haiku prompt
  // as highlights.fastGloss, but keyed to a practice_text (so the LLM can use
  // the body as context) without requiring a highlight row. No persistence —
  // the client caches via TanStack Query keyed on (textId, selectionText).
  fastGloss: oc
    .route({ method: 'POST', path: '/practice/texts/{practiceTextId}/fast-gloss', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        practiceTextId: z.string().uuid(),
        selectionText: z.string().trim().min(1).max(200),
      })
    )
    .output(
      z.object({
        data: z.object({
          gloss: z.string(),
          pos: z.string().nullable(),
          register: z.string().nullable(),
          ipa: GrammarIpaBagSchema.nullable(),
          // Lemma the IPA was sourced from on form-of fallback — see
          // glosses-contract's fastGloss output for the convention.
          ipaLemma: z.string().nullable(),
        }),
      })
    ),
} as const

import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'

// Upload batches stay well under the backend's 4 MB JSON body limit; the web
// client packs parts into batches of at most this many chars of text.
export const BOOK_UPLOAD_BATCH_MAX_CHARS = 600_000
// A part is one reading session: a chapter, or a slice of an over-long one.
export const BOOK_MAX_PARTS = 1_000
// Hard cap per segment: the reader sends a whole segment as the gloss
// contextLine (max 2000), so book paragraphs are split below this.
export const BOOK_SEGMENT_MAX_CHARS = 1_500

const BookPartUploadSchema = z.object({
  partIndex: z
    .number()
    .int()
    .min(0)
    .max(BOOK_MAX_PARTS - 1),
  title: z.string().min(1).max(300),
  segments: z.array(z.string().min(1).max(BOOK_SEGMENT_MAX_CHARS)).min(1),
})

export const BookPartSchema = z.object({
  textTrackId: z.string().uuid(),
  partIndex: z.number().int(),
  title: z.string(),
  segmentCount: z.number().int(),
  // Null until the part is first opened (sessions are created lazily).
  sessionId: z.string().uuid().nullable(),
  furthestReadSegmentIndex: z.number().int().nullable(),
  lastReadAt: z.string().nullable(),
})
export type BookPart = z.infer<typeof BookPartSchema>

// Pinned-book priority state (docs/SRS.md §4 "Pinned book"). `analysis`
// reports the per-part lemma analysis the boost reads: 'unsupported' (no
// dictionary data for the language — pinning is refused), 'analyzing' (some
// parts pending; the analyzed ones already count), 'partly_failed' (some parts
// terminally failed — retryAnalysis), 'ready'. `quota` is today's book share
// of the daily new budget and how much of it is used; null when unpinned.
// `pinnedElsewhereTitle` names the language's currently pinned OTHER book, so
// pinning this one can say which book it replaces.
export const BookPrioritySchema = z.object({
  pinned: z.boolean(),
  pinnedElsewhereTitle: z.string().nullable(),
  analysis: z.object({
    status: z.enum(['unsupported', 'analyzing', 'partly_failed', 'ready']),
    failedPartCount: z.number().int(),
  }),
  quota: z
    .object({
      quota: z.number().int(),
      introducedToday: z.number().int(),
    })
    .nullable(),
})
export type BookPriority = z.infer<typeof BookPrioritySchema>

export const BookSchema = z.object({
  contentSourceId: z.string().uuid(),
  title: z.string(),
  author: z.string().nullable(),
  language: z.string(),
  parts: z.array(BookPartSchema),
  // The part read most recently (latest lastReadAt), else the first part.
  currentPartIndex: z.number().int(),
  priority: BookPrioritySchema,
})
export type Book = z.infer<typeof BookSchema>

// "Learn before you read" (docs/READER-SPEC.md, book page). One row per
// frequent word in the chapters ahead that the user neither knows nor has
// saved: `lemma` is the folded key the write endpoints take back, `headword`
// its dictionary spelling for display, `aheadCount` the estimated occurrences
// within the requested horizon, and segmentId/surface/context its first
// occurrence after the reading position (the evidence line, and a Learn
// card's context).
export const PrelearnItemSchema = z.object({
  lemma: z.string(),
  headword: z.string(),
  aheadCount: z.number().int(),
  segmentId: z.string().uuid(),
  surface: z.string(),
  context: z.string(),
})
export type PrelearnItem = z.infer<typeof PrelearnItemSchema>

export const PrelearnHorizonSchema = z.enum(['next_part', 'rest_of_book'])
export type PrelearnHorizon = z.infer<typeof PrelearnHorizonSchema>

const PRELEARN_MAX_ITEMS = 30
const PrelearnLemmaSchema = z.string().trim().min(1).max(100)

const UploadErrors = {
  BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
  NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
  // The upload was reset or superseded (another tab started uploading this
  // book, or a newer book upload replaced it): the client restarts.
  CONFLICT: { status: 409, data: BackendErrorResponseSchema },
  INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
} as const

export const booksContract = {
  // Starts (or restarts) an upload, or resolves a re-upload of a book the user
  // already has: dedup is per user on the hash of the book's normalized text.
  // `alreadyExisted` = a ready book with this hash exists; the client skips
  // the upload and opens it. Otherwise the returned `uploadId` must accompany
  // every appendParts/finalize call of this attempt.
  create: oc
    .route({ method: 'POST', path: '/books', successStatus: 200 })
    .errors({
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
      // 'GUEST_SOURCE_LIMIT_REACHED': anonymous user with a full library —
      // checked before any upload so a guest never sends megabytes for nothing.
      FORBIDDEN: { status: 403, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        title: z.string().min(1).max(300),
        author: z.string().max(300).nullable(),
        language: z.string().min(2),
        fileName: z.string().max(500),
        contentHash: z.string().regex(/^[0-9a-f]{64}$/),
        partCount: z.number().int().min(1).max(BOOK_MAX_PARTS),
      })
    )
    .output(
      z.object({
        data: z.object({
          contentSourceId: z.string().uuid(),
          alreadyExisted: z.boolean(),
          uploadId: z.string().uuid().nullable(),
        }),
      })
    ),

  // Idempotent per partIndex: re-sending a part that already arrived is a no-op.
  appendParts: oc
    .route({ method: 'POST', path: '/books/{contentSourceId}/parts', successStatus: 200 })
    .errors(UploadErrors)
    .input(
      z.object({
        contentSourceId: z.string().uuid(),
        uploadId: z.string().uuid(),
        parts: z.array(BookPartUploadSchema).min(1),
      })
    )
    .output(z.object({ data: z.object({ receivedPartCount: z.number().int() }) })),

  // Checks every part arrived, moderates a sample, then atomically creates the
  // first part's session and marks the book ready. Idempotent: finalizing a
  // ready book returns its first part's session.
  finalize: oc
    .route({ method: 'POST', path: '/books/{contentSourceId}/finalize', successStatus: 200 })
    .errors({
      ...UploadErrors,
      // 'CONTENT_BLOCKED': the moderation sample hard-blocked; the book is deleted.
      UNPROCESSABLE_ENTITY: { status: 422, data: BackendErrorResponseSchema },
      // 'GUEST_SOURCE_LIMIT_REACHED' (the library filled up during the upload);
      // the book stays uploading, so finalize can be retried.
      FORBIDDEN: { status: 403, data: BackendErrorResponseSchema },
      // `native_language_not_set` (finish onboarding first) or `cefr_not_set`
      // (set a level for the book's language, then retry).
      PRECONDITION_FAILED: { status: 412, data: BackendErrorResponseSchema },
    })
    .input(z.object({ contentSourceId: z.string().uuid(), uploadId: z.string().uuid() }))
    .output(z.object({ data: z.object({ sessionId: z.string().uuid() }) })),

  get: oc
    .route({ method: 'GET', path: '/books/{contentSourceId}', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ contentSourceId: z.string().uuid() }))
    .output(z.object({ data: BookSchema })),

  // Find-or-create the session for one part (sessions are created lazily).
  openPart: oc
    .route({ method: 'POST', path: '/books/{contentSourceId}/parts/{partIndex}/open', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      FORBIDDEN: { status: 403, data: BackendErrorResponseSchema },
      PRECONDITION_FAILED: { status: 412, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ contentSourceId: z.string().uuid(), partIndex: z.coerce.number().int().min(0) }))
    .output(z.object({ data: z.object({ sessionId: z.string().uuid() }) })),

  // Pins the book for its language: never-introduced words frequent in its
  // unread parts get up to half of the daily new budget. Replaces any other
  // pinned book of the same language. UNPROCESSABLE_ENTITY
  // (`UNSUPPORTED_LANGUAGE`) when the language has no dictionary data.
  pin: oc
    .route({ method: 'POST', path: '/books/{contentSourceId}/pin', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      UNPROCESSABLE_ENTITY: { status: 422, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ contentSourceId: z.string().uuid() }))
    .output(z.object({ data: z.object({ ok: z.literal(true) }) })),

  // Unpins the book if it is the pinned one (idempotent). Words already
  // introduced keep their schedules.
  unpin: oc
    .route({ method: 'DELETE', path: '/books/{contentSourceId}/pin', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ contentSourceId: z.string().uuid() }))
    .output(z.object({ data: z.object({ ok: z.literal(true) }) })),

  // Re-enqueues the lemma analysis of every part that isn't analyzed,
  // including terminally failed ones (the 'partly_failed' Retry).
  retryAnalysis: oc
    .route({ method: 'POST', path: '/books/{contentSourceId}/retry-analysis', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ contentSourceId: z.string().uuid() }))
    .output(z.object({ data: z.object({ ok: z.literal(true) }) })),

  // The "Learn before you read" list: at most 30 words that occur at least
  // MIN_BOOK_OCCURRENCES_AHEAD times in the rest of the book (so a card made
  // from the list joins the pinned-book stream) and at least once within the
  // horizon, ordered by occurrences within it. `savedCount` counts the words
  // that qualify but are already saved. Empty for languages without
  // dictionary data.
  getPrelearnCandidates: oc
    .route({ method: 'GET', path: '/books/{contentSourceId}/prelearn', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ contentSourceId: z.string().uuid(), horizon: PrelearnHorizonSchema }))
    .output(
      z.object({
        data: z.object({ items: z.array(PrelearnItemSchema), savedCount: z.number().int() }),
      })
    ),

  // Short glosses of listed words in their listed sentence, cached per
  // occurrence (one batched LLM call for the uncached ones). Words or segments
  // that aren't this book's are ignored; a word whose gloss couldn't be made
  // is absent from the result.
  getPrelearnGlosses: oc
    .route({ method: 'POST', path: '/books/{contentSourceId}/prelearn/glosses', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        contentSourceId: z.string().uuid(),
        items: z
          .array(
            z.object({
              lemma: PrelearnLemmaSchema,
              headword: z.string().trim().min(1).max(200),
              segmentId: z.string().uuid(),
              context: z.string().max(400),
            })
          )
          .min(1)
          .max(PRELEARN_MAX_ITEMS),
      })
    )
    .output(z.object({ data: z.object({ glosses: z.array(z.object({ lemma: z.string(), gloss: z.string() })) }) })),

  // Marks one listed word as known (provenance: this book). Undo is
  // studySessions.unmarkKnownLemma. NOT_FOUND also for a word not in the book.
  markPrelearnKnown: oc
    .route({ method: 'POST', path: '/books/{contentSourceId}/prelearn/known', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ contentSourceId: z.string().uuid(), lemma: PrelearnLemmaSchema }))
    .output(z.object({ data: z.object({ markedCount: z.number().int() }) })),

  // Saves one listed word as a recognition-only card, built from its upcoming
  // sentence (an ordinary adhoc save). BAD_REQUEST carries
  // `native_language_not_set` / `cefr_not_set` like cards.createAdhoc.
  learnPrelearnWord: oc
    .route({ method: 'POST', path: '/books/{contentSourceId}/prelearn/learn', successStatus: 200 })
    .errors({
      BAD_REQUEST: { status: 400, data: BackendErrorResponseSchema },
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        contentSourceId: z.string().uuid(),
        lemma: PrelearnLemmaSchema,
        headword: z.string().trim().min(1).max(200),
        context: z.string().trim().max(400),
      })
    )
    .output(z.object({ data: z.object({ cardId: z.string().uuid() }) })),

  // Removes the book from the library: every part session is soft-deleted in
  // one statement (kept vocabulary survives, like single-session removal) and
  // the book is unpinned. The source and its tracks stay for dedup —
  // re-uploading starts fresh sessions, unpinned.
  remove: oc
    .route({ method: 'DELETE', path: '/books/{contentSourceId}', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ contentSourceId: z.string().uuid() }))
    .output(z.object({ data: z.object({ ok: z.literal(true) }) })),
} as const

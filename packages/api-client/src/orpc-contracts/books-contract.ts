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

export const BookSchema = z.object({
  contentSourceId: z.string().uuid(),
  title: z.string(),
  author: z.string().nullable(),
  language: z.string(),
  parts: z.array(BookPartSchema),
  // The part read most recently (latest lastReadAt), else the first part.
  currentPartIndex: z.number().int(),
})
export type Book = z.infer<typeof BookSchema>

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

  // Removes the book from the library: every part session is soft-deleted in
  // one statement (kept vocabulary survives, like single-session removal).
  // The source and its tracks stay for dedup — re-uploading starts fresh
  // sessions.
  remove: oc
    .route({ method: 'DELETE', path: '/books/{contentSourceId}', successStatus: 200 })
    .errors({
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ contentSourceId: z.string().uuid() }))
    .output(z.object({ data: z.object({ ok: z.literal(true) }) })),
} as const

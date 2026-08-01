import { oc } from '@orpc/contract'
import { z } from 'zod'
import { BackendErrorResponseSchema } from './common/error-response-schema'
import { StudySessionSchema } from './common/flicktionary-schemas'

// A public catalog entry. Deliberately minimal: no source/track UUIDs (the
// add flow goes through the entry id so removed entries stop being addable),
// no raw source URL (extension-imported URLs can carry signed tokens or
// private paths — only the server-parsed domain is public).
export const SharedContentEntrySchema = z.object({
  id: z.string().uuid(),
  language: z.string(),
  title: z.string(),
  type: z.string(),
  youtubeVideoId: z.string().nullable(),
  sourceDomain: z.string().nullable(),
  featured: z.boolean(),
  createdAt: z.string(),
})

export const SharedContentEntryStatusSchema = z.enum(['live', 'unshared', 'removed'])

// The full-text preview behind a catalog card: same public posture as the
// list entry (no source/track UUIDs), plus the track's complete text so users
// can read what something is before adding it. Word count / reading time are
// derived client-side (language-aware segmentation lives there already).
// Non-admins only ever receive live entries (status 'live', removedReason
// null); admins get non-live entries too so moderation isn't blind.
export const SharedContentEntryDetailSchema = SharedContentEntrySchema.extend({
  text: z.string(),
  segmentCount: z.number().int(),
  status: SharedContentEntryStatusSchema,
  removedReason: z.string().nullable(),
})

export const SharedContentShareStateSchema = z.enum(['shared', 'not-shared', 'not-shareable'])

export const AdminSharedContentEntrySchema = SharedContentEntrySchema.extend({
  status: SharedContentEntryStatusSchema,
  contentSourceId: z.string().uuid(),
  textTrackId: z.string().uuid(),
  canonicalKey: z.string(),
  sharedByUserId: z.string().uuid().nullable(),
  removedReason: z.string().nullable(),
})

export const sharedContentContract = {
  list: oc
    .route({ method: 'GET', path: '/shared-content', successStatus: 200 })
    .errors({
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        language: z.string().optional(),
        featuredOnly: z.coerce.boolean().optional(),
      })
    )
    .output(z.object({ data: z.array(SharedContentEntrySchema) })),

  // The '/detail' suffix (rather than a bare GET /shared-content/{entryId})
  // keeps the param path from competing with the static GET
  // /shared-content/share-state route, mirroring the '/{entryId}/add' shape.
  get: oc
    .route({ method: 'GET', path: '/shared-content/{entryId}/detail', successStatus: 200 })
    .errors({
      // Unknown id, or the entry is no longer live (unshared/removed).
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ entryId: z.string().uuid() }))
    .output(z.object({ data: SharedContentEntryDetailSchema })),

  addToLibrary: oc
    .route({ method: 'POST', path: '/shared-content/{entryId}/add', successStatus: 201 })
    .errors({
      // Entry no longer live (unshared or removed since the client fetched it).
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      // 'GUEST_SOURCE_LIMIT_REACHED': the guest library cap, same as every
      // session-creating procedure.
      FORBIDDEN: { status: 403, data: BackendErrorResponseSchema },
      // 'CEFR_REQUIRED': no CEFR preference for the entry's language — the
      // client opens the CEFR dialog and retries.
      UNPROCESSABLE_ENTITY: { status: 422, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(
      z.object({
        entryId: z.string().uuid(),
        // Snapshot fallback only — the live users row wins, mirroring
        // studySessions.create.
        nativeLanguage: z.string(),
      })
    )
    .output(z.object({ data: StudySessionSchema, alreadyExisted: z.boolean() })),

  getShareState: oc
    .route({ method: 'GET', path: '/shared-content/share-state', successStatus: 200 })
    .errors({
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ textTrackId: z.string().uuid() }))
    .output(z.object({ data: z.object({ state: SharedContentShareStateSchema }) })),

  setShared: oc
    .route({ method: 'PUT', path: '/shared-content/share-state', successStatus: 200 })
    .errors({
      // Not the owner, non-shareable type, or an anonymous user.
      FORBIDDEN: { status: 403, data: BackendErrorResponseSchema },
      // Tombstoned by an admin, the same content is already shared by someone
      // else, or the content didn't pass moderation.
      CONFLICT: { status: 409, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ textTrackId: z.string().uuid(), shared: z.boolean() }))
    .output(z.object({ data: z.object({ state: SharedContentShareStateSchema }) })),

  adminList: oc
    .route({ method: 'GET', path: '/shared-content/admin/entries', successStatus: 200 })
    .errors({
      FORBIDDEN: { status: 403, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    // The filter is server-side (WHERE before LIMIT): client-side filtering
    // over the flat latest-N would silently lose older unshared/removed
    // entries once the catalog outgrows the cap.
    .input(z.object({ status: SharedContentEntryStatusSchema.optional() }))
    .output(z.object({ data: z.array(AdminSharedContentEntrySchema) })),

  adminRemove: oc
    .route({ method: 'POST', path: '/shared-content/admin/entries/{entryId}/remove', successStatus: 200 })
    .errors({
      FORBIDDEN: { status: 403, data: BackendErrorResponseSchema },
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ entryId: z.string().uuid(), reason: z.string().min(1).max(500) }))
    .output(z.object({ data: AdminSharedContentEntrySchema })),

  adminSetFeatured: oc
    .route({ method: 'PUT', path: '/shared-content/admin/entries/{entryId}/featured', successStatus: 200 })
    .errors({
      FORBIDDEN: { status: 403, data: BackendErrorResponseSchema },
      NOT_FOUND: { status: 404, data: BackendErrorResponseSchema },
      INTERNAL_SERVER_ERROR: { status: 500, data: BackendErrorResponseSchema },
    })
    .input(z.object({ entryId: z.string().uuid(), featured: z.boolean() }))
    .output(z.object({ data: AdminSharedContentEntrySchema })),
} as const

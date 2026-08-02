import type postgres from 'postgres'
import { sql, beginTx } from '../postgres-client'
import { Tables, Database } from '../database.public.types'

export type DbSharedContentEntry = Tables<'shared_content_entries'>
export type ContentSourceType = Database['public']['Enums']['content_source_type']

// Feed/admin rows carry the presentational fields from content_sources so the
// router never exposes the raw source row (or its metadata) wholesale.
export type DbSharedContentEntryWithSource = DbSharedContentEntry & {
  title: string
  type: ContentSourceType
  metadata: Record<string, unknown>
}

const isPostgresUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505'

// Publish insert with the catalog's identity rules: a pre-existing row for the
// track (live, unshared, or tombstoned) is never resurrected, and a canonical
// key that is currently live (someone else already shared this content) or
// tombstoned (admin verdict sticks across copies) blocks the insert. A mere
// unshare by another user does NOT block — their row keeps its key but the
// partial unique index only covers live rows.
const insertIfPublishable = async (params: {
  contentSourceId: string
  textTrackId: string
  canonicalKey: string
  language: string
  sharedByUserId: string
  moderatedTitle: string
}): Promise<DbSharedContentEntry | null> => {
  try {
    return await beginTx(async (tx) => {
      // FOR SHARE blocks a concurrent re-ingest's title UPDATE until this tx
      // commits, so the title-change fence always runs with the entry already
      // visible; a title that changed since it was moderated aborts the
      // publish instead of going live unchecked.
      const sourceRows = (await tx`
        SELECT title FROM public.content_sources WHERE id = ${params.contentSourceId} FOR SHARE
      `) as { title: string }[]
      if (sourceRows[0]?.title !== params.moderatedTitle) return null
      const blocked = await tx`
        SELECT 1 FROM public.shared_content_entries
        WHERE text_track_id = ${params.textTrackId}
           OR (canonical_key = ${params.canonicalKey} AND (removed_at IS NOT NULL OR unshared_at IS NULL))
        LIMIT 1
      `
      if (blocked.length > 0) return null
      const result = (await tx`
        INSERT INTO public.shared_content_entries
          (content_source_id, text_track_id, canonical_key, language, shared_by_user_id)
        VALUES (
          ${params.contentSourceId},
          ${params.textTrackId},
          ${params.canonicalKey},
          ${params.language},
          ${params.sharedByUserId}
        )
        ON CONFLICT DO NOTHING
        RETURNING *
      `) as DbSharedContentEntry[]
      return result[0] ?? null
    })
  } catch (error) {
    // A concurrent publish of the same canonical content between the probe and
    // the insert loses the race on the live-key unique index — same outcome as
    // the probe hitting: not published.
    if (isPostgresUniqueViolation(error)) return null
    throw error
  }
}

const hasLiveEntriesForSource = async (contentSourceId: string): Promise<boolean> => {
  const result = await sql`
    SELECT 1 FROM public.shared_content_entries
    WHERE content_source_id = ${contentSourceId}
      AND unshared_at IS NULL AND removed_at IS NULL
    LIMIT 1
  `
  return result.length > 0
}

const findByTextTrackId = async (textTrackId: string): Promise<DbSharedContentEntry | null> => {
  const result = (await sql`
    SELECT * FROM public.shared_content_entries WHERE text_track_id = ${textTrackId}
  `) as DbSharedContentEntry[]
  return result[0] ?? null
}

const findById = async (id: string): Promise<DbSharedContentEntry | null> => {
  const result = (await sql`
    SELECT * FROM public.shared_content_entries WHERE id = ${id}
  `) as DbSharedContentEntry[]
  return result[0] ?? null
}

// Row-locked liveness check for the add-to-library transaction: the FOR SHARE
// lock serializes against a concurrent unshare/removal, so a session can never
// be created from an entry that is already dead when the tx commits.
const lockLiveById = async (id: string, db: postgres.Sql): Promise<DbSharedContentEntry | null> => {
  const result = (await db`
    SELECT * FROM public.shared_content_entries
    WHERE id = ${id} AND unshared_at IS NULL AND removed_at IS NULL
    FOR SHARE
  `) as DbSharedContentEntry[]
  return result[0] ?? null
}

// Feed rows carry `in_library`: whether the viewer already has a live session
// on this entry's content. The join key is exactly addToLibrary's
// find-or-create identity — the partial unique index on
// (user_id, text_track_id, target_language) WHERE deleted_at IS NULL — so the
// LEFT JOIN is index-backed and matches at most one row. The sharer's own
// entry counts as in-library too (they have a session on the track).
export type DbSharedContentFeedEntry = DbSharedContentEntryWithSource & { in_library: boolean }

const listLive = async (params: {
  viewerUserId: string
  language: string | null
  featuredOnly: boolean
  limit: number
}): Promise<DbSharedContentFeedEntry[]> => {
  return (await sql`
    SELECT e.*, cs.title, cs.type, cs.metadata, (ss.id IS NOT NULL) AS in_library
    FROM public.shared_content_entries e
    JOIN public.content_sources cs ON cs.id = e.content_source_id
    LEFT JOIN public.study_sessions ss
      ON ss.user_id = ${params.viewerUserId}
      AND ss.text_track_id = e.text_track_id
      AND ss.target_language = e.language
      AND ss.deleted_at IS NULL
    WHERE e.unshared_at IS NULL AND e.removed_at IS NULL
      ${params.language ? sql`AND e.language = ${params.language}` : sql``}
      ${params.featuredOnly ? sql`AND e.featured = TRUE` : sql``}
    ORDER BY e.featured DESC, e.created_at DESC
    LIMIT ${params.limit}
  `) as DbSharedContentFeedEntry[]
}

const findByIdWithSource = async (id: string): Promise<DbSharedContentEntryWithSource | null> => {
  const result = (await sql`
    SELECT e.*, cs.title, cs.type, cs.metadata
    FROM public.shared_content_entries e
    JOIN public.content_sources cs ON cs.id = e.content_source_id
    WHERE e.id = ${id}
  `) as DbSharedContentEntryWithSource[]
  return result[0] ?? null
}

// The status filter runs in SQL (WHERE before LIMIT): filtering the flat
// latest-N client-side would silently lose older unshared/removed entries
// once the catalog outgrows the cap.
const listForAdmin = async (
  limit: number,
  status: 'live' | 'unshared' | 'removed' | null
): Promise<DbSharedContentEntryWithSource[]> => {
  const statusClause =
    status === 'removed'
      ? sql`AND e.removed_at IS NOT NULL`
      : status === 'unshared'
        ? sql`AND e.unshared_at IS NOT NULL AND e.removed_at IS NULL`
        : status === 'live'
          ? sql`AND e.unshared_at IS NULL AND e.removed_at IS NULL`
          : sql``
  return (await sql`
    SELECT e.*, cs.title, cs.type, cs.metadata
    FROM public.shared_content_entries e
    JOIN public.content_sources cs ON cs.id = e.content_source_id
    WHERE TRUE
      ${statusClause}
    ORDER BY e.created_at DESC
    LIMIT ${limit}
  `) as DbSharedContentEntryWithSource[]
}

// Owner opt-out. Upserts so that turning sharing off BEFORE a pending
// fire-and-forget publish lands still wins: the pre-created row makes the
// publish's ON CONFLICT DO NOTHING a no-op.
const upsertUnshared = async (params: {
  contentSourceId: string
  textTrackId: string
  canonicalKey: string
  language: string
  sharedByUserId: string
}): Promise<void> => {
  await sql`
    INSERT INTO public.shared_content_entries
      (content_source_id, text_track_id, canonical_key, language, shared_by_user_id, unshared_at)
    VALUES (
      ${params.contentSourceId},
      ${params.textTrackId},
      ${params.canonicalKey},
      ${params.language},
      ${params.sharedByUserId},
      NOW()
    )
    ON CONFLICT (text_track_id)
    DO UPDATE SET unshared_at = NOW()
  `
}

export type ReshareResult = 'reshared' | 'tombstoned' | 'no-entry' | 'canonical-conflict' | 'stale-title'

// Owner opt-in on a previously unshared entry, under the same identity rules
// as a fresh publish: an admin tombstone on ANY copy of this canonical
// content sticks (removed rows are outside the partial unique index, so only
// this explicit check enforces it), a live copy elsewhere conflicts, and a
// title mutated since the caller moderated it aborts (same FOR SHARE fence as
// insertIfPublishable). Tombstoned own entries never come back.
const reshare = async (params: {
  textTrackId: string
  contentSourceId: string
  canonicalKey: string
  moderatedTitle: string
}): Promise<ReshareResult> => {
  try {
    return await beginTx(async (tx) => {
      const sourceRows = (await tx`
        SELECT title FROM public.content_sources WHERE id = ${params.contentSourceId} FOR SHARE
      `) as { title: string }[]
      if (sourceRows[0]?.title !== params.moderatedTitle) return 'stale-title'
      const blocked = await tx`
        SELECT 1 FROM public.shared_content_entries
        WHERE canonical_key = ${params.canonicalKey}
          AND text_track_id <> ${params.textTrackId}
          AND (removed_at IS NOT NULL OR unshared_at IS NULL)
        LIMIT 1
      `
      if (blocked.length > 0) return 'canonical-conflict'
      const result = (await tx`
        UPDATE public.shared_content_entries
        SET unshared_at = NULL
        WHERE text_track_id = ${params.textTrackId} AND removed_at IS NULL
        RETURNING id
      `) as { id: string }[]
      if (result.length > 0) return 'reshared'
      const existing = await tx`
        SELECT 1 FROM public.shared_content_entries WHERE text_track_id = ${params.textTrackId}
      `
      return existing.length > 0 ? ('tombstoned' as const) : ('no-entry' as const)
    })
  } catch (error) {
    // A same-key copy going live between the probe and the UPDATE still trips
    // the partial unique index — same outcome as the probe hitting.
    if (isPostgresUniqueViolation(error)) return 'canonical-conflict'
    throw error
  }
}

// Title-change fence: a re-ingest that mutates a source title with a bad one
// takes down every live entry showing it.
const unshareAllLiveForSource = async (contentSourceId: string): Promise<void> => {
  await sql`
    UPDATE public.shared_content_entries
    SET unshared_at = NOW()
    WHERE content_source_id = ${contentSourceId} AND unshared_at IS NULL AND removed_at IS NULL
  `
}

// Account deletion: the sharer is going away, their public entries go with
// them (recipients' existing sessions are untouched by design).
const unshareAllLiveForUser = async (userId: string): Promise<void> => {
  await sql`
    UPDATE public.shared_content_entries
    SET unshared_at = NOW()
    WHERE shared_by_user_id = ${userId} AND unshared_at IS NULL AND removed_at IS NULL
  `
}

// Session soft-delete: without a session the owner has no toggle surface left
// for this track, so the entry must not stay public.
const unshareLiveForUserAndTrack = async (userId: string, textTrackId: string): Promise<void> => {
  await sql`
    UPDATE public.shared_content_entries
    SET unshared_at = NOW()
    WHERE shared_by_user_id = ${userId}
      AND text_track_id = ${textTrackId}
      AND unshared_at IS NULL AND removed_at IS NULL
  `
}

const setFeatured = async (id: string, featured: boolean): Promise<DbSharedContentEntry | null> => {
  const result = (await sql`
    UPDATE public.shared_content_entries
    SET featured = ${featured}
    WHERE id = ${id}
    RETURNING *
  `) as DbSharedContentEntry[]
  return result[0] ?? null
}

const removeAsAdmin = async (id: string, reason: string): Promise<DbSharedContentEntry | null> => {
  const result = (await sql`
    UPDATE public.shared_content_entries
    SET removed_at = NOW(), removed_reason = ${reason}
    WHERE id = ${id}
    RETURNING *
  `) as DbSharedContentEntry[]
  return result[0] ?? null
}

export interface SharedContentEntriesRepositoryInterface {
  insertIfPublishable: (params: {
    contentSourceId: string
    textTrackId: string
    canonicalKey: string
    language: string
    sharedByUserId: string
    moderatedTitle: string
  }) => Promise<DbSharedContentEntry | null>
  hasLiveEntriesForSource: (contentSourceId: string) => Promise<boolean>
  findByTextTrackId: (textTrackId: string) => Promise<DbSharedContentEntry | null>
  findById: (id: string) => Promise<DbSharedContentEntry | null>
  lockLiveById: (id: string, db: postgres.Sql) => Promise<DbSharedContentEntry | null>
  findByIdWithSource: (id: string) => Promise<DbSharedContentEntryWithSource | null>
  listLive: (params: {
    viewerUserId: string
    language: string | null
    featuredOnly: boolean
    limit: number
  }) => Promise<DbSharedContentFeedEntry[]>
  listForAdmin: (
    limit: number,
    status: 'live' | 'unshared' | 'removed' | null
  ) => Promise<DbSharedContentEntryWithSource[]>
  upsertUnshared: (params: {
    contentSourceId: string
    textTrackId: string
    canonicalKey: string
    language: string
    sharedByUserId: string
  }) => Promise<void>
  reshare: (params: {
    textTrackId: string
    contentSourceId: string
    canonicalKey: string
    moderatedTitle: string
  }) => Promise<ReshareResult>
  unshareAllLiveForSource: (contentSourceId: string) => Promise<void>
  unshareAllLiveForUser: (userId: string) => Promise<void>
  unshareLiveForUserAndTrack: (userId: string, textTrackId: string) => Promise<void>
  setFeatured: (id: string, featured: boolean) => Promise<DbSharedContentEntry | null>
  removeAsAdmin: (id: string, reason: string) => Promise<DbSharedContentEntry | null>
}

export const SharedContentEntriesRepository = (): SharedContentEntriesRepositoryInterface => {
  return {
    insertIfPublishable,
    hasLiveEntriesForSource,
    findByTextTrackId,
    findById,
    lockLiveById,
    findByIdWithSource,
    listLive,
    listForAdmin,
    upsertUnshared,
    reshare,
    unshareAllLiveForSource,
    unshareAllLiveForUser,
    unshareLiveForUserAndTrack,
    setFeatured,
    removeAsAdmin,
  }
}

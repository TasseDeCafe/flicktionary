import type postgres from 'postgres'
import { sql, beginTx } from '../postgres-client'
import { Tables, Database } from '../database.public.types'

export type DbStudySession = Tables<'study_sessions'>
export type DbTextTrack = Tables<'text_tracks'>
export type DbContentSource = Tables<'content_sources'>
export type DbTextSegment = Tables<'text_segments'>

// Joined shape used by the list/get views: every UI surface that shows a session
// also wants the movie title and poster from content_sources.
export type ContentSourceType = Database['public']['Enums']['content_source_type']

export type DbStudySessionWithSource = DbStudySession & {
  content_source_title: string | null
  content_source_type: ContentSourceType | null
  content_source_metadata: Record<string, unknown> | null
}

const insertStudySession = async (params: {
  userId: string
  contentSourceId: string
  textTrackId: string
  nativeLanguage: string
  targetLanguage: string
  cefrLevel: string
}): Promise<DbStudySession | null> => {
  const result = (await sql`
    INSERT INTO public.study_sessions (
      user_id, content_source_id, text_track_id,
      native_language, target_language, cefr_level
    )
    SELECT
      ${params.userId},
      ${params.contentSourceId},
      ${params.textTrackId},
      ${params.nativeLanguage},
      ${params.targetLanguage},
      ${params.cefrLevel}
    WHERE EXISTS (
      SELECT 1
      FROM public.text_tracks
      WHERE id = ${params.textTrackId}
        AND content_source_id = ${params.contentSourceId}
    )
    RETURNING *
  `) as DbStudySession[]
  return result[0] ?? null
}

const getOrCreateAdhocStudySession = async (params: {
  userId: string
  targetLanguage: string
  nativeLanguage: string
  cefrLevel: string
  title: string
  trackHash: string
  contextBlob: string
}): Promise<{ session: DbStudySession; track: DbTextTrack }> => {
  return await beginTx(async (tx) => {
    await tx`
      SELECT pg_advisory_xact_lock(hashtext(${`adhoc:${params.userId}:${params.targetLanguage}`}))
    `

    const insertedSource = (await tx`
      INSERT INTO public.content_sources (type, title, language, metadata, created_by_user_id)
      VALUES (
        'adhoc',
        ${params.title},
        ${params.targetLanguage},
        '{}'::jsonb,
        ${params.userId}
      )
      ON CONFLICT (created_by_user_id, language) WHERE type = 'adhoc'
        DO UPDATE SET title = EXCLUDED.title
      RETURNING *
    `) as Tables<'content_sources'>[]
    const contentSource = insertedSource[0]
    if (!contentSource) throw new Error('getOrCreateAdhocStudySession: content source upsert returned no row')

    const insertedTrack = (await tx`
      INSERT INTO public.text_tracks (content_source_id, source, language, external_id, hash)
      VALUES (
        ${contentSource.id},
        'paste',
        ${params.targetLanguage},
        NULL,
        ${params.trackHash}
      )
      ON CONFLICT (content_source_id, language, hash)
        DO UPDATE SET hash = EXCLUDED.hash
      RETURNING *
    `) as DbTextTrack[]
    const track = insertedTrack[0]
    if (!track) throw new Error('getOrCreateAdhocStudySession: track upsert returned no row')

    const existing = (await tx`
      SELECT s.*
      FROM public.study_sessions s
      WHERE s.user_id = ${params.userId}
        AND s.content_source_id = ${contentSource.id}
        AND s.target_language = ${params.targetLanguage}
        AND s.deleted_at IS NULL
      LIMIT 1
    `) as DbStudySession[]

    if (existing[0]) {
      const updated = (await tx`
        UPDATE public.study_sessions
        SET native_language = ${params.nativeLanguage},
            cefr_level = ${params.cefrLevel},
            context_blob = COALESCE(context_blob, ${params.contextBlob})
        WHERE id = ${existing[0].id}
        RETURNING *
      `) as DbStudySession[]
      const session = updated[0]
      if (!session) throw new Error('getOrCreateAdhocStudySession: session refresh returned no row')
      return { session, track }
    }

    const insertedSession = (await tx`
      INSERT INTO public.study_sessions (
        user_id, content_source_id, text_track_id,
        native_language, target_language, cefr_level,
        context_blob
      )
      VALUES (
        ${params.userId},
        ${contentSource.id},
        ${track.id},
        ${params.nativeLanguage},
        ${params.targetLanguage},
        ${params.cefrLevel},
        ${params.contextBlob}
      )
      RETURNING *
    `) as DbStudySession[]

    const session = insertedSession[0]
    if (!session) throw new Error('getOrCreateAdhocStudySession: session insert returned no row')
    return { session, track }
  })
}

// Shared tail of both extension ingestion flows (YouTube + streaming). Once the
// content_source row exists, the rest is identical: upsert the text_track,
// insert segments on first sight, and find-or-create the study_session. Runs
// inside the caller's transaction (`tx`).
//
// Identity model:
// - One content_source per source key (YouTube: (user, youtubeVideoId);
//   streaming: (user, contentHash)) — the caller owns that upsert.
// - One text_track per (content_source, subtitleLanguage, subtitleHash).
//   Same subtitle content (byte-identical hash) → same track. Different content
//   (e.g. regenerated/Whisper subtitles) → fresh track, leaving old highlights
//   intact against the old track.
// - One study_session per (user, text_track, target_language). The partial
//   unique index `study_sessions_user_track_target_lang_unique` enforces this.
//   We use `ON CONFLICT DO NOTHING + re-SELECT` so concurrent inserters don't
//   poison the surrounding transaction with a unique-violation rollback.
const completeExtensionIngest = async (
  tx: postgres.Sql,
  params: {
    userId: string
    contentSource: DbContentSource
    subtitleLanguage: string
    subtitleHash: string
    // Imported text (article/selection) has no timing, so startMs/endMs are null;
    // subtitle flows pass real millisecond offsets. Stored verbatim either way.
    subtitleSegments: ReadonlyArray<{ index: number; text: string; startMs: number | null; endMs: number | null }>
    nativeLanguage: string
    targetLanguage: string
    cefrLevel: string
  }
): Promise<{
  session: DbStudySession
  track: DbTextTrack
  contentSource: DbContentSource
  segments: DbTextSegment[]
}> => {
  const contentSource = params.contentSource

  const insertedTrack = (await tx`
    INSERT INTO public.text_tracks (content_source_id, source, language, external_id, hash)
    VALUES (
      ${contentSource.id},
      'paste',
      ${params.subtitleLanguage},
      NULL,
      ${params.subtitleHash}
    )
    ON CONFLICT (content_source_id, language, hash)
      DO UPDATE SET hash = EXCLUDED.hash
    RETURNING *
  `) as DbTextTrack[]
  const track = insertedTrack[0]
  if (!track) throw new Error('completeExtensionIngest: track upsert returned no row')

  // Insert segments only if this looks like a freshly-created track. The
  // ON CONFLICT clause is still required: concurrent register/save cold-starts
  // can both observe an empty track before either transaction commits.
  const existingCount = (await tx`
    SELECT COUNT(*)::int AS c FROM public.text_segments WHERE text_track_id = ${track.id}
  `) as Array<{ c: number }>

  if ((existingCount[0]?.c ?? 0) === 0 && params.subtitleSegments.length > 0) {
    const rows = params.subtitleSegments.map((s) => ({
      text_track_id: track.id,
      index: s.index,
      text: s.text,
      start_ms: s.startMs,
      end_ms: s.endMs,
    }))
    await tx`
      INSERT INTO public.text_segments ${tx(rows, 'text_track_id', 'index', 'text', 'start_ms', 'end_ms')}
      ON CONFLICT (text_track_id, index) DO NOTHING
    `
  }

  const segments = (await tx`
    SELECT id, text_track_id, index, text, start_ms, end_ms, tsv
    FROM public.text_segments
    WHERE text_track_id = ${track.id}
    ORDER BY index ASC
  `) as DbTextSegment[]

  // ON CONFLICT DO NOTHING + re-SELECT avoids aborting the transaction on a
  // concurrent insert race. The partial unique index serializes the
  // operation; one inserter wins, the other reads the winner's row.
  const insertedSession = (await tx`
    INSERT INTO public.study_sessions (
      user_id, content_source_id, text_track_id,
      native_language, target_language, cefr_level
    )
    VALUES (
      ${params.userId},
      ${contentSource.id},
      ${track.id},
      ${params.nativeLanguage},
      ${params.targetLanguage},
      ${params.cefrLevel}
    )
    ON CONFLICT (user_id, text_track_id, target_language) WHERE deleted_at IS NULL
      DO NOTHING
    RETURNING *
  `) as DbStudySession[]

  if (insertedSession[0]) {
    return { session: insertedSession[0], track, contentSource, segments }
  }

  const existing = (await tx`
    SELECT * FROM public.study_sessions
    WHERE user_id = ${params.userId}
      AND text_track_id = ${track.id}
      AND target_language = ${params.targetLanguage}
      AND deleted_at IS NULL
    LIMIT 1
  `) as DbStudySession[]
  const session = existing[0]
  if (!session) throw new Error('completeExtensionIngest: session upsert returned no row and re-SELECT was empty')
  return { session, track, contentSource, segments }
}

// Idempotent ingestion entry point for the browser extension's YouTube flow.
// content_source key: (user, youtubeVideoId).
const getOrCreateForYoutubeVideo = async (params: {
  userId: string
  youtubeVideoId: string
  videoTitle: string
  videoUrl: string
  videoAudioLanguage: string
  subtitleLanguage: string
  subtitleHash: string
  subtitleSegments: ReadonlyArray<{ index: number; text: string; startMs: number; endMs: number }>
  nativeLanguage: string
  targetLanguage: string
  cefrLevel: string
}): Promise<{
  session: DbStudySession
  track: DbTextTrack
  contentSource: DbContentSource
  segments: DbTextSegment[]
}> => {
  return await beginTx(async (tx) => {
    const csMetadata = {
      youtubeVideoId: params.youtubeVideoId,
      videoTitle: params.videoTitle,
      videoUrl: params.videoUrl,
    }
    const insertedSource = (await tx`
      INSERT INTO public.content_sources (type, title, language, metadata, created_by_user_id)
      VALUES (
        'youtube',
        ${params.videoTitle},
        ${params.videoAudioLanguage},
        ${tx.json(csMetadata)},
        ${params.userId}
      )
      ON CONFLICT (created_by_user_id, (metadata ->> 'youtubeVideoId')) WHERE type = 'youtube'
        DO UPDATE SET
          title = EXCLUDED.title,
          metadata = public.content_sources.metadata || EXCLUDED.metadata
      RETURNING *
    `) as DbContentSource[]
    const contentSource = insertedSource[0]
    if (!contentSource) throw new Error('getOrCreateForYoutubeVideo: content source upsert returned no row')

    return completeExtensionIngest(tx, {
      userId: params.userId,
      contentSource,
      subtitleLanguage: params.subtitleLanguage,
      subtitleHash: params.subtitleHash,
      subtitleSegments: params.subtitleSegments,
      nativeLanguage: params.nativeLanguage,
      targetLanguage: params.targetLanguage,
      cefrLevel: params.cefrLevel,
    })
  })
}

// Idempotent ingestion entry point for the extension's streaming-site flow
// (Netflix, Prime, …). content_source key: (user, subtitle contentHash). No
// per-site video id is parsed — the hash that already identifies the text_track
// is reused as the source's natural key (see the streaming uniqueness index).
const getOrCreateForStreamingVideo = async (params: {
  userId: string
  videoTitle: string
  videoUrl: string
  contentHash: string
  subtitleLanguage: string
  subtitleSegments: ReadonlyArray<{ index: number; text: string; startMs: number; endMs: number }>
  nativeLanguage: string
  targetLanguage: string
  cefrLevel: string
}): Promise<{
  session: DbStudySession
  track: DbTextTrack
  contentSource: DbContentSource
  segments: DbTextSegment[]
}> => {
  return await beginTx(async (tx) => {
    const csMetadata = {
      contentHash: params.contentHash,
      videoTitle: params.videoTitle,
      videoUrl: params.videoUrl,
    }
    const insertedSource = (await tx`
      INSERT INTO public.content_sources (type, title, language, metadata, created_by_user_id)
      VALUES (
        'streaming',
        ${params.videoTitle},
        ${params.subtitleLanguage},
        ${tx.json(csMetadata)},
        ${params.userId}
      )
      ON CONFLICT (created_by_user_id, (metadata ->> 'contentHash')) WHERE type = 'streaming'
        DO UPDATE SET
          title = EXCLUDED.title,
          metadata = public.content_sources.metadata || EXCLUDED.metadata
      RETURNING *
    `) as DbContentSource[]
    const contentSource = insertedSource[0]
    if (!contentSource) throw new Error('getOrCreateForStreamingVideo: content source upsert returned no row')

    return completeExtensionIngest(tx, {
      userId: params.userId,
      contentSource,
      subtitleLanguage: params.subtitleLanguage,
      subtitleHash: params.contentHash,
      subtitleSegments: params.subtitleSegments,
      nativeLanguage: params.nativeLanguage,
      targetLanguage: params.targetLanguage,
      cefrLevel: params.cefrLevel,
    })
  })
}

// Idempotent ingestion entry point for the browser extension's text-import flow:
// a Readability-extracted article (type 'article', sourceUrl set) or an
// arbitrary text selection (type 'text', sourceUrl null — semantically a paste).
// content_source key: (user, contentHash), where contentHash is the SHA-256 of
// the parsed text segments, reused as the text_track hash. Same body text → same
// source/track/session. See content_sources_imported_text_user_content_hash_unique.
const getOrCreateForImportedText = async (params: {
  userId: string
  type: 'article' | 'text'
  title: string
  sourceUrl: string | null
  contentHash: string
  language: string
  segments: ReadonlyArray<{ index: number; text: string }>
  nativeLanguage: string
  targetLanguage: string
  cefrLevel: string
}): Promise<{
  session: DbStudySession
  track: DbTextTrack
  contentSource: DbContentSource
  segments: DbTextSegment[]
}> => {
  return await beginTx(async (tx) => {
    const csMetadata = {
      contentHash: params.contentHash,
      sourceUrl: params.sourceUrl,
    }
    const insertedSource = (await tx`
      INSERT INTO public.content_sources (type, title, language, metadata, created_by_user_id)
      VALUES (
        ${params.type},
        ${params.title},
        ${params.language},
        ${tx.json(csMetadata)},
        ${params.userId}
      )
      ON CONFLICT (created_by_user_id, (metadata ->> 'contentHash'))
        WHERE type IN ('article', 'text') AND metadata ? 'contentHash'
        DO UPDATE SET
          title = EXCLUDED.title,
          metadata = public.content_sources.metadata || EXCLUDED.metadata
      RETURNING *
    `) as DbContentSource[]
    const contentSource = insertedSource[0]
    if (!contentSource) throw new Error('getOrCreateForImportedText: content source upsert returned no row')

    return completeExtensionIngest(tx, {
      userId: params.userId,
      contentSource,
      subtitleLanguage: params.language,
      subtitleHash: params.contentHash,
      subtitleSegments: params.segments.map((s) => ({ ...s, startMs: null, endMs: null })),
      nativeLanguage: params.nativeLanguage,
      targetLanguage: params.targetLanguage,
      cefrLevel: params.cefrLevel,
    })
  })
}

// Lookup-only counterpart to the two find-or-create video flows — NEVER
// creates rows. Resolves the documented identity chain: content_source by
// (user, type, metadata natural key: youtubeVideoId / contentHash) →
// text_track by (content_source_id, hash) — hash only, the extension doesn't
// know the server-detected language — → live study_session
// (user, track, deleted_at IS NULL) → segments by index. Null at any miss
// (the normal never-saved state). Plain reads, no transaction needed.
const findForVideo = async (params: {
  userId: string
  source: 'youtube' | 'streaming'
  youtubeVideoId?: string
  contentHash: string
}): Promise<{
  session: DbStudySession
  track: DbTextTrack
  contentSource: DbContentSource
  segments: DbTextSegment[]
} | null> => {
  const sources = (await (params.source === 'youtube'
    ? sql`
        SELECT * FROM public.content_sources
        WHERE created_by_user_id = ${params.userId}
          AND type = 'youtube'
          AND metadata ->> 'youtubeVideoId' = ${params.youtubeVideoId ?? ''}
        LIMIT 1
      `
    : sql`
        SELECT * FROM public.content_sources
        WHERE created_by_user_id = ${params.userId}
          AND type = 'streaming'
          AND metadata ->> 'contentHash' = ${params.contentHash}
        LIMIT 1
      `)) as DbContentSource[]
  const contentSource = sources[0]
  if (!contentSource) return null

  const tracks = (await sql`
    SELECT * FROM public.text_tracks
    WHERE content_source_id = ${contentSource.id}
      AND hash = ${params.contentHash}
    LIMIT 1
  `) as DbTextTrack[]
  const track = tracks[0]
  if (!track) return null

  const sessions = (await sql`
    SELECT * FROM public.study_sessions
    WHERE user_id = ${params.userId}
      AND text_track_id = ${track.id}
      AND deleted_at IS NULL
    LIMIT 1
  `) as DbStudySession[]
  const session = sessions[0]
  if (!session) return null

  const segments = (await sql`
    SELECT id, text_track_id, index, text, start_ms, end_ms, tsv
    FROM public.text_segments
    WHERE text_track_id = ${track.id}
    ORDER BY index ASC
  `) as DbTextSegment[]

  return { session, track, contentSource, segments }
}

// Soft-deleted sessions are filtered out everywhere except softDelete itself
// and the highlight/card chains, which keep working so kept vocabulary can
// still back-link to its source. Hard erasure happens via account deletion
// (auth.users CASCADE).
//
// Adhoc sessions (the synthetic per-(user, language) "Personal vocabulary"
// rows that back the "Add a word" flow) are filtered out here too so they
// don't pollute the Sessions list. Their cards still surface in Vocabulary
// and Practice through the user_lookups path.
const listByUserIdWithSource = async (userId: string): Promise<DbStudySessionWithSource[]> => {
  return (await sql`
    SELECT s.*,
           cs.title AS content_source_title,
           cs.type AS content_source_type,
           cs.metadata AS content_source_metadata
    FROM public.study_sessions s
    LEFT JOIN public.content_sources cs ON cs.id = s.content_source_id
    WHERE s.user_id = ${userId} AND s.deleted_at IS NULL AND cs.type != 'adhoc'
    ORDER BY s.created_at DESC
  `) as DbStudySessionWithSource[]
}

const findByIdForUserWithSource = async (
  sessionId: string,
  userId: string
): Promise<DbStudySessionWithSource | null> => {
  const result = (await sql`
    SELECT s.*,
           cs.title AS content_source_title,
           cs.type AS content_source_type,
           cs.metadata AS content_source_metadata
    FROM public.study_sessions s
    LEFT JOIN public.content_sources cs ON cs.id = s.content_source_id
    WHERE s.id = ${sessionId} AND s.user_id = ${userId} AND s.deleted_at IS NULL
  `) as DbStudySessionWithSource[]
  return result[0] ?? null
}

const findByIdForUser = async (sessionId: string, userId: string): Promise<DbStudySession | null> => {
  const result = (await sql`
    SELECT * FROM public.study_sessions
    WHERE id = ${sessionId} AND user_id = ${userId} AND deleted_at IS NULL
  `) as DbStudySession[]
  return result[0] ?? null
}

const hasTextTrackForUser = async (textTrackId: string, userId: string): Promise<boolean> => {
  const result = await sql`
    SELECT 1
    FROM public.study_sessions
    WHERE text_track_id = ${textTrackId}
      AND user_id = ${userId}
      AND deleted_at IS NULL
    LIMIT 1
  `
  return result.length > 0
}

const listByUserId = async (userId: string): Promise<DbStudySession[]> => {
  return (await sql`
    SELECT * FROM public.study_sessions
    WHERE user_id = ${userId} AND deleted_at IS NULL
    ORDER BY created_at DESC
  `) as DbStudySession[]
}

const updateContextBlob = async (sessionId: string, userId: string, contextBlob: string): Promise<boolean> => {
  const result = await sql`
    UPDATE public.study_sessions
    SET context_blob = ${contextBlob}
    WHERE id = ${sessionId} AND user_id = ${userId} AND deleted_at IS NULL
  `
  return result.count === 1
}

// Records the deepest segment the reader has reached. GREATEST keeps it monotonic
// server-side too, so an out-of-order (lower) write — e.g. a throttled flush that
// lands after a later one — can never walk the resume position backwards.
const updateReadingProgress = async (sessionId: string, userId: string, segmentIndex: number): Promise<boolean> => {
  const result = await sql`
    UPDATE public.study_sessions
    SET furthest_read_segment_index = GREATEST(COALESCE(furthest_read_segment_index, -1), ${segmentIndex})
    WHERE id = ${sessionId} AND user_id = ${userId} AND deleted_at IS NULL
  `
  return result.count === 1
}

const appendProcessingWarning = async (sessionId: string, userId: string, warning: string): Promise<boolean> => {
  const result = await sql`
    UPDATE public.study_sessions
    SET processing_warnings = array_append(processing_warnings, ${warning})
    WHERE id = ${sessionId} AND user_id = ${userId} AND deleted_at IS NULL
  `
  return result.count === 1
}

const softDelete = async (sessionId: string, userId: string): Promise<boolean> => {
  const result = await sql`
    UPDATE public.study_sessions
    SET deleted_at = NOW()
    WHERE id = ${sessionId} AND user_id = ${userId} AND deleted_at IS NULL
  `
  return result.count === 1
}

export type DeletePreview = {
  highlightCount: number
  cardCount: number
  keptCardCount: number
}

const getDeletePreview = async (sessionId: string, userId: string): Promise<DeletePreview | null> => {
  const result = (await sql`
    SELECT
      (SELECT COUNT(*)::int FROM public.highlights h WHERE h.study_session_id = s.id) AS highlight_count,
      (SELECT COUNT(*)::int FROM public.cards c WHERE c.study_session_id = s.id) AS card_count,
      (SELECT COUNT(*)::int FROM public.cards c WHERE c.study_session_id = s.id AND c.status = 'kept') AS kept_card_count
    FROM public.study_sessions s
    WHERE s.id = ${sessionId} AND s.user_id = ${userId} AND s.deleted_at IS NULL
  `) as Array<{
    highlight_count: number
    card_count: number
    kept_card_count: number
  }>
  const row = result[0]
  if (!row) return null
  return {
    highlightCount: row.highlight_count,
    cardCount: row.card_count,
    keptCardCount: row.kept_card_count,
  }
}

export interface StudySessionsRepositoryInterface {
  insertStudySession: (params: {
    userId: string
    contentSourceId: string
    textTrackId: string
    nativeLanguage: string
    targetLanguage: string
    cefrLevel: string
  }) => Promise<DbStudySession | null>
  getOrCreateAdhocStudySession: (params: {
    userId: string
    targetLanguage: string
    nativeLanguage: string
    cefrLevel: string
    title: string
    trackHash: string
    contextBlob: string
  }) => Promise<{ session: DbStudySession; track: DbTextTrack }>
  getOrCreateForYoutubeVideo: (params: {
    userId: string
    youtubeVideoId: string
    videoTitle: string
    videoUrl: string
    videoAudioLanguage: string
    subtitleLanguage: string
    subtitleHash: string
    subtitleSegments: ReadonlyArray<{ index: number; text: string; startMs: number; endMs: number }>
    nativeLanguage: string
    targetLanguage: string
    cefrLevel: string
  }) => Promise<{
    session: DbStudySession
    track: DbTextTrack
    contentSource: DbContentSource
    segments: DbTextSegment[]
  }>
  getOrCreateForStreamingVideo: (params: {
    userId: string
    videoTitle: string
    videoUrl: string
    contentHash: string
    subtitleLanguage: string
    subtitleSegments: ReadonlyArray<{ index: number; text: string; startMs: number; endMs: number }>
    nativeLanguage: string
    targetLanguage: string
    cefrLevel: string
  }) => Promise<{
    session: DbStudySession
    track: DbTextTrack
    contentSource: DbContentSource
    segments: DbTextSegment[]
  }>
  getOrCreateForImportedText: (params: {
    userId: string
    type: 'article' | 'text'
    title: string
    sourceUrl: string | null
    contentHash: string
    language: string
    segments: ReadonlyArray<{ index: number; text: string }>
    nativeLanguage: string
    targetLanguage: string
    cefrLevel: string
  }) => Promise<{
    session: DbStudySession
    track: DbTextTrack
    contentSource: DbContentSource
    segments: DbTextSegment[]
  }>
  findForVideo: (params: {
    userId: string
    source: 'youtube' | 'streaming'
    youtubeVideoId?: string
    contentHash: string
  }) => Promise<{
    session: DbStudySession
    track: DbTextTrack
    contentSource: DbContentSource
    segments: DbTextSegment[]
  } | null>
  findByIdForUser: (sessionId: string, userId: string) => Promise<DbStudySession | null>
  findByIdForUserWithSource: (sessionId: string, userId: string) => Promise<DbStudySessionWithSource | null>
  hasTextTrackForUser: (textTrackId: string, userId: string) => Promise<boolean>
  listByUserId: (userId: string) => Promise<DbStudySession[]>
  listByUserIdWithSource: (userId: string) => Promise<DbStudySessionWithSource[]>
  updateContextBlob: (sessionId: string, userId: string, contextBlob: string) => Promise<boolean>
  updateReadingProgress: (sessionId: string, userId: string, segmentIndex: number) => Promise<boolean>
  appendProcessingWarning: (sessionId: string, userId: string, warning: string) => Promise<boolean>
  softDelete: (sessionId: string, userId: string) => Promise<boolean>
  getDeletePreview: (sessionId: string, userId: string) => Promise<DeletePreview | null>
}

export const StudySessionsRepository = (): StudySessionsRepositoryInterface => {
  return {
    insertStudySession,
    getOrCreateAdhocStudySession,
    getOrCreateForYoutubeVideo,
    getOrCreateForStreamingVideo,
    getOrCreateForImportedText,
    findForVideo,
    findByIdForUser,
    findByIdForUserWithSource,
    hasTextTrackForUser,
    listByUserId,
    listByUserIdWithSource,
    updateContextBlob,
    updateReadingProgress,
    appendProcessingWarning,
    softDelete,
    getDeletePreview,
  }
}

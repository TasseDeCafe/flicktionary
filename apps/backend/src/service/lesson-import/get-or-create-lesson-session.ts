import type postgres from 'postgres'
import type { Tables } from '../../transport/database/database.public.types'
import type { DbImportBatch } from '../../transport/database/import-batches/import-batches-repository'
import type { DbStudySession, DbTextTrack } from '../../transport/database/study-sessions/study-sessions-repository'

// Create the full session chain for a confirmed lesson batch, inside the
// caller's confirm transaction. Unlike the adhoc flow's one-source-per-
// (user, language) upsert, EVERY batch gets its own content_source (type
// 'lesson', titled after the upload) — lessons are discrete events, and their
// sessions must not merge. study_sessions requires content_source_id +
// text_track_id, so the chain is source -> track -> session. The context blob
// is a static non-empty description (chat and on-demand exploration
// short-circuit on null blobs; there is no narrative text to summarize).
export const getOrCreateLessonSession = async (
  params: {
    batch: DbImportBatch
    userId: string
    nativeLanguage: string
    cefrLevel: string
  },
  tx: postgres.Sql
): Promise<{ session: DbStudySession; track: DbTextTrack }> => {
  const { batch, userId } = params

  // Idempotence guard: a batch that already owns a session (a previous confirm
  // attempt that failed after this point, or a re-entrant call) reuses it.
  if (batch.study_session_id) {
    const existing = (await tx`
      SELECT s.* FROM public.study_sessions s
      WHERE s.id = ${batch.study_session_id} AND s.user_id = ${userId} AND s.deleted_at IS NULL
    `) as DbStudySession[]
    if (existing[0]) {
      const track = (await tx`
        SELECT * FROM public.text_tracks WHERE id = ${existing[0].text_track_id}
      `) as DbTextTrack[]
      if (track[0]) return { session: existing[0], track: track[0] }
    }
  }

  const insertedSource = (await tx`
    INSERT INTO public.content_sources (type, title, language, metadata, created_by_user_id)
    VALUES ('lesson', ${batch.source_title}, ${batch.target_language}, '{}'::jsonb, ${userId})
    RETURNING *
  `) as Tables<'content_sources'>[]
  const contentSource = insertedSource[0]
  if (!contentSource) throw new Error('getOrCreateLessonSession: content source insert returned no row')

  const insertedTrack = (await tx`
    INSERT INTO public.text_tracks (content_source_id, source, language, external_id, hash)
    VALUES (${contentSource.id}, 'paste', ${batch.target_language}, NULL, ${batch.input_hash})
    RETURNING *
  `) as DbTextTrack[]
  const track = insertedTrack[0]
  if (!track) throw new Error('getOrCreateLessonSession: track insert returned no row')

  const contextBlob = `Vocabulary imported from the learner's language-lesson notes ("${batch.source_title}"): new words, error corrections, and pronunciation items collected by their teacher during lessons. Each line is an independent item — there is no surrounding narrative.`

  const insertedSession = (await tx`
    INSERT INTO public.study_sessions (
      user_id, content_source_id, text_track_id,
      native_language, target_language, cefr_level, context_blob
    )
    VALUES (
      ${userId},
      ${contentSource.id},
      ${track.id},
      ${params.nativeLanguage},
      ${batch.target_language},
      ${params.cefrLevel},
      ${contextBlob}
    )
    RETURNING *
  `) as DbStudySession[]
  const session = insertedSession[0]
  if (!session) throw new Error('getOrCreateLessonSession: session insert returned no row')
  return { session, track }
}

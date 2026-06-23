import { logWithSentry } from '../../transport/third-party/sentry/error-monitoring'
import { generateContextBlob } from '../../transport/third-party/anthropic/passes/generate-context-blob'
import type { ContentSourcesRepositoryInterface } from '../../transport/database/content-sources/content-sources-repository'
import type { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'
import type {
  DbStudySession,
  StudySessionsRepositoryInterface,
} from '../../transport/database/study-sessions/study-sessions-repository'

const CONTEXT_BLOB_SAMPLE_SIZE = 150

export type EnsureSessionContextBlobDependencies = {
  contentSourcesRepository: ContentSourcesRepositoryInterface
  textSegmentsRepository: TextSegmentsRepositoryInterface
  studySessionsRepository: StudySessionsRepositoryInterface
}

// Returns the session's context blob, generating-and-persisting it lazily on the
// first call when missing. Sampling the opening slice avoids loading the whole
// track for long reads.
//
// The blob is required by every downstream LLM path (basic-data enrichment,
// per-card chat, on-demand exploration). The note-only save lane never runs an
// enrich_highlight job, so a note-only-only session has no blob — this helper
// mints it on the first chat/exploration instead of at save time, keeping
// note-only saves LLM-free. Returns null only when the content source is gone.
export const ensureSessionContextBlob = async (
  session: DbStudySession,
  userId: string,
  deps: EnsureSessionContextBlobDependencies
): Promise<string | null> => {
  if (session.context_blob) return session.context_blob

  const contentSource = await deps.contentSourcesRepository.findById(session.content_source_id)
  if (!contentSource) {
    logWithSentry({
      message: 'ensureSessionContextBlob: content source not found',
      params: { sessionId: session.id },
    })
    return null
  }

  const sampleSegments = await deps.textSegmentsRepository.listFirstByTrackId(
    session.text_track_id,
    CONTEXT_BLOB_SAMPLE_SIZE
  )
  const contextBlob = await generateContextBlob({
    contentTitle: contentSource.title,
    contentLanguage: session.target_language,
    contentType: contentSource.type,
    segmentSample: sampleSegments.map((s) => s.text).join('\n'),
  })
  await deps.studySessionsRepository.updateContextBlob(session.id, userId, contextBlob)
  return contextBlob
}

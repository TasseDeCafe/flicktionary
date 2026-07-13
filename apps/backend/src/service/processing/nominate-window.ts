import { logWithSentry } from '../../transport/third-party/sentry/error-monitoring'
import { NominatedSpan } from '../../transport/third-party/anthropic/passes/nominate-candidates-pass'
import { recordPassTelemetry } from './telemetry'
import { getLanguageMode } from '../user-prefs/language-mode'
import type { ProcessingDependencies } from './processing-dependencies'
import { GhostCandidateInsert } from '../../transport/database/ghost-candidates/ghost-candidates-repository'

const CONTEXT_BLOB_SAMPLE_SIZE = 150

// Reconcile the model's char offsets against the segment's stored text. LLMs miscount
// characters, so we trust surface_form over the offsets: if the slice already matches
// we keep the offsets (this is what disambiguates a unit occurring twice); otherwise we
// locate surface_form in the text. Returns null when the span can't be anchored at all.
export const reconcileOffsets = (
  segmentText: string,
  span: NominatedSpan
): { charStart: number; charEnd: number } | null => {
  const { charStart, charEnd, surfaceForm } = span
  const inBounds =
    Number.isInteger(charStart) &&
    Number.isInteger(charEnd) &&
    charStart >= 0 &&
    charEnd <= segmentText.length &&
    charEnd > charStart
  if (inBounds && segmentText.slice(charStart, charEnd) === surfaceForm) {
    return { charStart, charEnd }
  }
  // Offsets were off. Recover only when the surface form occurs exactly once; when
  // it recurs, falling back to the first occurrence would anchor the wrong ghost.
  const idx = segmentText.indexOf(surfaceForm)
  if (idx === -1) return null
  if (segmentText.indexOf(surfaceForm, idx + surfaceForm.length) !== -1) return null
  return { charStart: idx, charEnd: idx + surfaceForm.length }
}

// Nominate-only background job for one reading window: nominate spans worth studying
// over [startIndex, endIndex] and persist them as passive ghost candidates, then mark
// the window covered. Gated on the LLM-suggestions pref (defence — the enqueue path
// also guards it). Never enriches; enrichment happens only if the user adopts a ghost.
export const nominateWindow = async (
  params: { sessionId: string; userId: string; startIndex: number; endIndex: number },
  deps: ProcessingDependencies
): Promise<void> => {
  const { sessionId, userId, startIndex, endIndex } = params
  const {
    anthropicPasses,
    contentSourcesRepository,
    textSegmentsRepository,
    studySessionsRepository,
    usersRepository,
    userTargetLanguagePrefsRepository,
    processingTelemetryRepository,
    ghostCandidatesRepository,
    nominatedWindowsRepository,
  } = deps

  const startedAt = Date.now()

  const session = await studySessionsRepository.findByIdForUser(sessionId, userId)
  if (!session) {
    logWithSentry({ message: 'nominateWindow: session not found', params: { sessionId, userId } })
    return
  }

  // Mark the window covered up-front, regardless of how nomination goes, so the
  // reader never re-requests it (a window that yields nothing is still "covered").
  const finish = () => nominatedWindowsRepository.markDone({ sessionId, startIndex, endIndex })

  const llmHighlightsEnabled = await usersRepository.getLlmHighlightsEnabled(userId)
  if (!llmHighlightsEnabled) {
    await finish()
    return
  }

  const segments = await textSegmentsRepository.listByIndexRange(session.text_track_id, startIndex, endIndex)
  if (segments.length === 0) {
    await finish()
    return
  }

  // Context blob: generate-and-persist on first use, read the cache after (shared
  // with the other processing jobs).
  let contextBlob = session.context_blob
  if (!contextBlob) {
    const contentSource = await contentSourcesRepository.findById(session.content_source_id)
    if (!contentSource) {
      logWithSentry({ message: 'nominateWindow: content source not found', params: { sessionId } })
      await finish()
      return
    }
    const sampleSegments = await textSegmentsRepository.listFirstByTrackId(
      session.text_track_id,
      CONTEXT_BLOB_SAMPLE_SIZE
    )
    contextBlob = await anthropicPasses.generateContextBlob({
      contentTitle: contentSource.title,
      contentLanguage: session.target_language,
      contentType: contentSource.type,
      segmentSample: sampleSegments.map((s) => s.text).join('\n'),
    })
    await studySessionsRepository.updateContextBlob(sessionId, userId, contextBlob)
  }

  const languagePrefs = await getLanguageMode({
    userId,
    targetLanguage: session.target_language,
    snapshotNativeLanguage: session.native_language,
    usersRepository,
    targetLanguagePrefsRepository: userTargetLanguagePrefsRepository,
  })
  const languageModeNativeLanguage = languagePrefs.nativeLanguage ?? session.target_language

  const spans = await anthropicPasses.nominateCandidatesPass({
    nativeLanguage: languageModeNativeLanguage,
    targetLanguage: session.target_language,
    cefrLevel: session.cefr_level,
    movieContextBlob: contextBlob,
    segments: segments.map((s) => ({ id: s.id, index: s.index, text: s.text })),
    hideTranslationFields: languagePrefs.hideTranslationFields,
    allowL1Notes: languagePrefs.allowL1Notes,
  })

  const segmentTextById = new Map(segments.map((s) => [s.id, s.text]))
  const inserts: GhostCandidateInsert[] = []
  let droppedCount = 0
  for (const span of spans) {
    const segmentText = segmentTextById.get(span.segmentId)
    if (segmentText === undefined) {
      droppedCount++
      continue
    }
    const offsets = reconcileOffsets(segmentText, span)
    if (!offsets) {
      droppedCount++
      continue
    }
    inserts.push({
      studySessionId: sessionId,
      segmentId: span.segmentId,
      charStart: offsets.charStart,
      charEnd: offsets.charEnd,
      surfaceForm: span.surfaceForm,
    })
  }

  await ghostCandidatesRepository.insertMany(inserts)
  await finish()

  await recordPassTelemetry(processingTelemetryRepository, {
    studySessionId: sessionId,
    passName: 'window_nomination',
    durationMs: Date.now() - startedAt,
    payload: {
      startIndex,
      endIndex,
      segmentCount: segments.length,
      nominatedCount: spans.length,
      keptCount: inserts.length,
      droppedCount,
    },
  })
}

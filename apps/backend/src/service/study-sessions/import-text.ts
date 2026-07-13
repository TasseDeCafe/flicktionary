import { createHash } from 'crypto'
import { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import type { AnthropicPassesInterface } from '../../transport/third-party/anthropic/anthropic-passes'
import { logWithSentry } from '../../transport/third-party/sentry/error-monitoring'
import { parsePastedText } from '../../utils/text-paste-parser'

// languageDetectionPass reads the first ~1k chars; concatenating a few dozen
// segments is more than enough to identify the language while keeping the
// prompt small.
const DETECTION_SAMPLE_CHARS = 1_000

export const buildDetectionSample = (segments: ReadonlyArray<{ text: string }>): string => {
  const parts: string[] = []
  let length = 0
  for (const segment of segments) {
    const text = segment.text.trim()
    if (text.length === 0) continue
    parts.push(text)
    length += text.length + 1
    if (length >= DETECTION_SAMPLE_CHARS) break
  }
  return parts.join('\n')
}

// Shared front half of every server-side ingestion flow (extension YouTube +
// streaming subtitles, extension text import, Telegram bot): detect the
// content language and resolve the user's native + CEFR prefs for it. Returns
// a discriminated result so each caller can map a failure to its own surface
// (typed oRPC errors for the extension, chat replies for the bot). The
// language detected here is the single source of truth — content language AND
// session target language.
export type IngestPrefs =
  | { ok: true; detectedLanguage: string; nativeLanguage: string; cefrLevel: string }
  | { ok: false; reason: 'unsupported' }
  // Native language is missing → the user hasn't completed onboarding. This is
  // NOT recoverable in-context (it's a global, one-time setup), so callers
  // route the user to web onboarding rather than offering a picker.
  | { ok: false; reason: 'needs-onboarding' }
  // Native language is set but CEFR for the detected language is missing →
  // callers offer an in-context per-language CEFR picker and retry.
  | { ok: false; reason: 'missing-cefr'; targetLanguage: string }

export type ImportTextDependencies = {
  studySessionsRepository: StudySessionsRepositoryInterface
  usersRepository: UsersRepositoryInterface
  userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface
  anthropicPasses: AnthropicPassesInterface
}

export const resolveIngestPrefs = async (
  userId: string,
  // Only the segment text is read (for language detection); subtitle and text
  // imports both satisfy this shape.
  segments: ReadonlyArray<{ text: string }>,
  deps: ImportTextDependencies
): Promise<IngestPrefs> => {
  const detectedLanguage = await deps.anthropicPasses.languageDetectionPass(buildDetectionSample(segments))
  if (!detectedLanguage) return { ok: false, reason: 'unsupported' }

  const [nativeLanguage, prefs] = await Promise.all([
    deps.usersRepository.getNativeLanguage(userId),
    deps.userTargetLanguagePrefsRepository.findForLanguage(userId, detectedLanguage),
  ])
  // native + CEFR live in user_prefs (set during onboarding), keyed by the
  // language being studied. The two gaps are distinct recovery flows: a
  // missing native language means onboarding wasn't completed (global,
  // one-time → onboarding); a missing CEFR is per-language (→ in-context
  // picker). Conflating them stranded users who set CEFR but had no native
  // language in an unbreakable "set your level" loop.
  if (!nativeLanguage) return { ok: false, reason: 'needs-onboarding' }
  if (!prefs?.cefr_level) return { ok: false, reason: 'missing-cefr', targetLanguage: detectedLanguage }
  return { ok: true, detectedLanguage, nativeLanguage, cefrLevel: prefs.cefr_level }
}

export type ImportTextResult =
  | {
      ok: true
      sessionId: string
      contentSourceId: string
      textTrackId: string
      segmentCount: number
      targetLanguage: string
    }
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: 'unsupported' }
  | { ok: false; reason: 'needs-onboarding' }
  | { ok: false; reason: 'missing-cefr'; targetLanguage: string }

// One-shot text ingestion: parse → detect language → resolve prefs → get or
// create source + track + segments + session. Idempotent by content hash, so
// importing the same body twice resolves to the same session.
export const importTextForUser = async (
  input: { userId: string; text: string; title: string; sourceUrl: string | null },
  deps: ImportTextDependencies
): Promise<ImportTextResult> => {
  const { userId, text, title, sourceUrl } = input

  // One segment per non-empty line, same parser the web paste wizard uses, so
  // text imported here reads identically to text pasted in the app.
  const parsed = parsePastedText(text)
  if (parsed.length === 0) return { ok: false, reason: 'empty' }

  const prefs = await resolveIngestPrefs(userId, parsed, deps)
  if (!prefs.ok) return prefs
  const { detectedLanguage, nativeLanguage, cefrLevel } = prefs

  // Natural key for idempotent re-import: hash of the parsed segment text.
  // Same normalization as the web paste dedup so identical bodies collapse.
  const contentHash = createHash('sha256')
    .update(parsed.map((s) => `|${s.text}`).join('\n'))
    .digest('hex')

  const { session, track, contentSource, segments } = await deps.studySessionsRepository.getOrCreateForImportedText({
    userId,
    type: sourceUrl ? 'article' : 'text',
    title,
    sourceUrl,
    contentHash,
    language: detectedLanguage,
    segments: parsed,
    nativeLanguage,
    targetLanguage: detectedLanguage,
    cefrLevel,
  })

  void deps.usersRepository.setLastTargetLanguage(userId, detectedLanguage).catch((error) => {
    logWithSentry({
      message: 'setLastTargetLanguage failed (text import)',
      params: { userId, targetLanguage: detectedLanguage },
      error,
    })
  })

  return {
    ok: true,
    sessionId: session.id,
    contentSourceId: contentSource.id,
    textTrackId: track.id,
    segmentCount: segments.length,
    targetLanguage: detectedLanguage,
  }
}

// Mirrors the web paste wizard's title suggestion so bot-imported sessions
// get the same "first words of the text" titles the app produces.
export const suggestTitleFromText = (text: string): string => {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (compact.length <= 60) return compact
  const truncated = compact.slice(0, 60)
  const lastSpace = truncated.lastIndexOf(' ')
  return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated) + '…'
}

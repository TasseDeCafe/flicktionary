import { createHash } from 'crypto'
import { describe, expect, test, vi } from 'vitest'
import { importTextForUser, ImportTextDependencies, suggestTitleFromText } from './import-text'
import type { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import type { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import type { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import type { TextTracksRepositoryInterface } from '../../transport/database/text-tracks/text-tracks-repository'
import type { ProcessingJobsRepositoryInterface } from '../../transport/database/processing-jobs/processing-jobs-repository'
import { MockAnthropicPasses } from '../../transport/third-party/anthropic/anthropic-passes'

const USER_ID = '00000000-0000-0000-0000-000000000001'

const buildDeps = (
  overrides: {
    detectedLanguage?: string | null
    nativeLanguage?: string | null
    cefrLevel?: string | null
  } = {}
): ImportTextDependencies => {
  const { detectedLanguage = 'ru', nativeLanguage = 'en', cefrLevel = 'B1' } = overrides
  return {
    studySessionsRepository: {
      getOrCreateForImportedText: vi.fn().mockResolvedValue({
        session: { id: 'session-1' },
        track: { id: 'track-1' },
        contentSource: { id: 'source-1' },
        segments: [{}, {}],
      }),
    } as unknown as StudySessionsRepositoryInterface,
    usersRepository: {
      getNativeLanguage: vi.fn().mockResolvedValue(nativeLanguage),
      setLastTargetLanguage: vi.fn().mockResolvedValue(true),
    } as unknown as UsersRepositoryInterface,
    userTargetLanguagePrefsRepository: {
      findForLanguage: vi.fn().mockResolvedValue(cefrLevel ? { cefr_level: cefrLevel } : null),
    } as unknown as UserTargetLanguagePrefsRepositoryInterface,
    anthropicPasses: MockAnthropicPasses({
      languageDetectionPass: vi.fn().mockResolvedValue(detectedLanguage),
    }),
    // The profile-job gate reads the track back; null short-circuits it.
    textTracksRepository: {
      findByIdWithSourceType: vi.fn().mockResolvedValue(null),
    } as unknown as TextTracksRepositoryInterface,
    processingJobsRepository: {
      enqueueBuildTrackLemmaProfile: vi.fn().mockResolvedValue(null),
    } as unknown as ProcessingJobsRepositoryInterface,
  }
}

describe('importTextForUser', () => {
  test('returns empty without calling language detection when the text has no readable lines', async () => {
    const deps = buildDeps()
    const result = await importTextForUser({ userId: USER_ID, text: '  \n\n  ', title: 'T', sourceUrl: null }, deps)
    expect(result).toEqual({ ok: false, reason: 'empty' })
    expect(deps.anthropicPasses.languageDetectionPass).not.toHaveBeenCalled()
  })

  test('returns unsupported when language detection finds no supported language', async () => {
    const deps = buildDeps({ detectedLanguage: null })
    const result = await importTextForUser({ userId: USER_ID, text: 'Hello', title: 'T', sourceUrl: null }, deps)
    expect(result).toEqual({ ok: false, reason: 'unsupported' })
  })

  test('returns needs-onboarding when the user has no native language', async () => {
    const deps = buildDeps({ nativeLanguage: null })
    const result = await importTextForUser({ userId: USER_ID, text: 'Привет', title: 'T', sourceUrl: null }, deps)
    expect(result).toEqual({ ok: false, reason: 'needs-onboarding' })
  })

  test('returns missing-cefr with the detected language when no CEFR pref exists', async () => {
    const deps = buildDeps({ cefrLevel: null })
    const result = await importTextForUser({ userId: USER_ID, text: 'Привет', title: 'T', sourceUrl: null }, deps)
    expect(result).toEqual({ ok: false, reason: 'missing-cefr', targetLanguage: 'ru' })
  })

  test('creates the session with parsed segments, resolved prefs, and the canonical content hash', async () => {
    const deps = buildDeps()
    const text = 'Привет мир\n\nКак дела'
    const result = await importTextForUser({ userId: USER_ID, text, title: 'My title', sourceUrl: null }, deps)

    expect(result).toEqual({
      ok: true,
      sessionId: 'session-1',
      contentSourceId: 'source-1',
      textTrackId: 'track-1',
      segmentCount: 2,
      targetLanguage: 'ru',
    })
    // The hash normalization (`|` prefix, `\n` join over parsed lines) is the
    // dedup key shared with the extension import path — a change here would
    // silently fork every re-imported text into a duplicate session.
    const expectedHash = createHash('sha256').update('|Привет мир\n|Как дела').digest('hex')
    expect(deps.studySessionsRepository.getOrCreateForImportedText).toHaveBeenCalledWith({
      userId: USER_ID,
      type: 'text',
      title: 'My title',
      sourceUrl: null,
      contentHash: expectedHash,
      language: 'ru',
      segments: [
        { index: 0, text: 'Привет мир' },
        { index: 1, text: 'Как дела' },
      ],
      nativeLanguage: 'en',
      targetLanguage: 'ru',
      cefrLevel: 'B1',
    })
    expect(deps.usersRepository.setLastTargetLanguage).toHaveBeenCalledWith(USER_ID, 'ru')
  })

  test('creates an article source when a sourceUrl is provided', async () => {
    const deps = buildDeps()
    await importTextForUser(
      { userId: USER_ID, text: 'Привет', title: 'T', sourceUrl: 'https://example.com/post' },
      deps
    )
    expect(deps.studySessionsRepository.getOrCreateForImportedText).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'article', sourceUrl: 'https://example.com/post' })
    )
  })
})

describe('suggestTitleFromText', () => {
  test('returns short text unchanged with whitespace compacted', () => {
    expect(suggestTitleFromText('  Привет   мир  ')).toBe('Привет мир')
  })

  test('truncates long text at a word boundary with an ellipsis', () => {
    const title = suggestTitleFromText(
      'Это очень длинный текст который совершенно точно не поместится в шестьдесят символов заголовка'
    )
    expect(title.length).toBeLessThanOrEqual(61)
    expect(title.endsWith('…')).toBe(true)
  })
})

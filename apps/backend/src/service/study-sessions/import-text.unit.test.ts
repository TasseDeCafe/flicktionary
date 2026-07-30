import { createHash } from 'crypto'
import { describe, expect, test, vi } from 'vitest'
import { importTextForUser, ImportTextDependencies, suggestTitleFromText } from './import-text'
import type { StudySessionsRepositoryInterface } from '../../transport/database/study-sessions/study-sessions-repository'
import type { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import type { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import type { TextTracksRepositoryInterface } from '../../transport/database/text-tracks/text-tracks-repository'
import type { ProcessingJobsRepositoryInterface } from '../../transport/database/processing-jobs/processing-jobs-repository'
import { MockAnthropicPasses } from '../../transport/third-party/anthropic/anthropic-passes'
import type { ModerationVerdict } from '../../transport/third-party/anthropic/passes/moderation-pass'

const USER_ID = '00000000-0000-0000-0000-000000000001'

const buildDeps = (
  overrides: {
    detectedLanguage?: string | null
    nativeLanguage?: string | null
    cefrLevel?: string | null
    moderationVerdict?: ModerationVerdict | null | Error
  } = {}
): ImportTextDependencies => {
  const {
    detectedLanguage = 'ru',
    nativeLanguage = 'en',
    cefrLevel = 'B1',
    moderationVerdict = { verdict: 'allow' } as ModerationVerdict,
  } = overrides
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
      moderationPass: (moderationVerdict instanceof Error
        ? vi.fn().mockRejectedValue(moderationVerdict)
        : vi.fn().mockResolvedValue(moderationVerdict)) as never,
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

const importInput = (text: string, extra: { title?: string; sourceUrl?: string | null } = {}) => ({
  userId: USER_ID,
  text,
  title: extra.title ?? 'T',
  sourceUrl: extra.sourceUrl ?? null,
  surface: 'extension-import' as const,
})

describe('importTextForUser', () => {
  test('returns empty without calling language detection or moderation when the text has no readable lines', async () => {
    const deps = buildDeps()
    const result = await importTextForUser(importInput('  \n\n  '), deps)
    expect(result).toEqual({ ok: false, reason: 'empty' })
    expect(deps.anthropicPasses.languageDetectionPass).not.toHaveBeenCalled()
    expect(deps.anthropicPasses.moderationPass).not.toHaveBeenCalled()
  })

  test('returns unsupported when language detection finds no supported language', async () => {
    const deps = buildDeps({ detectedLanguage: null })
    const result = await importTextForUser(importInput('Hello'), deps)
    expect(result).toEqual({ ok: false, reason: 'unsupported' })
  })

  test('returns needs-onboarding when the user has no native language', async () => {
    const deps = buildDeps({ nativeLanguage: null })
    const result = await importTextForUser(importInput('Привет'), deps)
    expect(result).toEqual({ ok: false, reason: 'needs-onboarding' })
  })

  test('returns missing-cefr with the detected language when no CEFR pref exists', async () => {
    const deps = buildDeps({ cefrLevel: null })
    const result = await importTextForUser(importInput('Привет'), deps)
    expect(result).toEqual({ ok: false, reason: 'missing-cefr', targetLanguage: 'ru' })
  })

  test('returns blocked and creates nothing when moderation hard-blocks the text', async () => {
    const deps = buildDeps({ moderationVerdict: { verdict: 'block', category: 'sexual-explicit' } })
    const result = await importTextForUser(importInput('Привет'), deps)
    expect(result).toEqual({ ok: false, reason: 'blocked', category: 'sexual-explicit' })
    expect(deps.studySessionsRepository.getOrCreateForImportedText).not.toHaveBeenCalled()
  })

  test('blocked outranks prefs failures so the user gets the honest error', async () => {
    const deps = buildDeps({ cefrLevel: null, moderationVerdict: { verdict: 'block', category: 'sexual-explicit' } })
    const result = await importTextForUser(importInput('Привет'), deps)
    expect(result).toEqual({ ok: false, reason: 'blocked', category: 'sexual-explicit' })
  })

  test('moderates the title together with the body', async () => {
    const deps = buildDeps()
    await importTextForUser(importInput('Привет мир', { title: 'My title' }), deps)
    expect(deps.anthropicPasses.moderationPass).toHaveBeenCalledWith('My title\nПривет мир')
  })

  test('a flagged verdict still imports and persists the flag on the track', async () => {
    const deps = buildDeps({ moderationVerdict: { verdict: 'flag', category: 'violence' } })
    const result = await importTextForUser(importInput('Привет'), deps)
    expect(result).toMatchObject({ ok: true })
    expect(deps.studySessionsRepository.getOrCreateForImportedText).toHaveBeenCalledWith(
      expect.objectContaining({ moderation: { status: 'flagged', category: 'violence' } })
    )
  })

  test('fails open with a null verdict when the moderation pass throws', async () => {
    const deps = buildDeps({ moderationVerdict: new Error('anthropic down') })
    const result = await importTextForUser(importInput('Привет'), deps)
    expect(result).toMatchObject({ ok: true })
    expect(deps.studySessionsRepository.getOrCreateForImportedText).toHaveBeenCalledWith(
      expect.objectContaining({ moderation: null })
    )
  })

  test('creates the session with parsed segments, resolved prefs, and the canonical content hash', async () => {
    const deps = buildDeps()
    const text = 'Привет мир\n\nКак дела'
    const result = await importTextForUser(importInput(text, { title: 'My title' }), deps)

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
      moderation: { status: 'clean', category: null },
    })
    expect(deps.usersRepository.setLastTargetLanguage).toHaveBeenCalledWith(USER_ID, 'ru')
  })

  test('creates an article source when a sourceUrl is provided', async () => {
    const deps = buildDeps()
    await importTextForUser(importInput('Привет', { sourceUrl: 'https://example.com/post' }), deps)
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

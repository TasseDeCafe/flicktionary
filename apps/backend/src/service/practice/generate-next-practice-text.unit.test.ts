import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generatePracticeText } from '../../transport/third-party/anthropic/passes/generate-practice-text'
import type { DbUserLookup } from '../../transport/database/user-lookups/user-lookups-repository'
import type { GenerateNextPracticeTextDependencies } from './generate-next-practice-text'
import { generateNextPracticeText } from './generate-next-practice-text'

vi.mock('../../transport/third-party/anthropic/passes/generate-practice-text', () => ({
  generatePracticeText: vi.fn(),
}))

const userId = '00000000-0000-0000-0000-000000000001'
const sessionId = '00000000-0000-0000-0000-000000000002'
const slotId = '00000000-0000-0000-0000-000000000003'
const lookupId = '00000000-0000-0000-0000-000000000004'

const lookup: DbUserLookup = {
  id: lookupId,
  user_id: userId,
  target_language: 'en',
  headword: 'whitherto',
  sense: 'reasons',
  translation: 'the reasons why',
  definition: null,
  target_example: null,
  native_example: null,
  exploration_extras: {},
  grammar: {},
  grounded_at: null,
  grammar_user_edited_at: null,
  first_card_id: null,
  exported_at: null,
  count: 1,
  srs_state: null,
  srs_due: null,
  srs_stability: null,
  srs_difficulty: null,
  srs_last_review: null,
  srs_reps: 0,
  srs_lapses: 0,
  added_to_practice_at: null,
  learning_mode: 'passive',
  active_srs_state: null,
  active_srs_due: null,
  active_srs_stability: null,
  active_srs_difficulty: null,
  active_srs_last_review: null,
  active_srs_reps: 0,
  active_srs_lapses: 0,
  created_at: '2026-05-12T00:00:00Z',
  deleted_at: null,
}

const createDeps = () => {
  const markReady = vi.fn()
  const markFailed = vi.fn()
  const deps = {
    practiceSessionsRepository: {
      findByIdForUser: vi.fn().mockResolvedValue({
        id: sessionId,
        user_id: userId,
        target_language: 'en',
        status: 'active',
        pool: 'passive',
      }),
      markCompleted: vi.fn(),
      markChunkAbandoned: vi.fn(),
    },
    practiceTextsRepository: {
      reserveOrFindNextSlot: vi.fn().mockResolvedValue({
        practiceText: {
          id: slotId,
          practice_session_id: sessionId,
          status: 'pending',
          created_at: '2026-05-12T00:00:00Z',
        },
        isFresh: true,
      }),
      claimGenerating: vi.fn().mockResolvedValue({ token: '00000000-0000-0000-0000-000000000005' }),
      markReady,
      markFailed,
      markReading: vi.fn(),
      getCoveredHeadwordSenses: vi.fn().mockResolvedValue([]),
      getSkippedChunkCountsForSession: vi.fn().mockResolvedValue([]),
      findById: vi.fn(),
    },
    practiceRatingsRepository: {
      getStubbornUserLookupIdsForSession: vi.fn().mockResolvedValue([]),
    },
    userLookupsRepository: {
      listEligibleForLanguage: vi.fn().mockResolvedValue([lookup]),
      initializeSrsState: vi.fn(),
      initializeSrsStateForPool: vi.fn(),
      findByKey: vi.fn().mockResolvedValue(lookup),
    },
    usersRepository: {
      getNativeLanguage: vi.fn().mockResolvedValue('fr'),
    },
    userTargetLanguagePrefsRepository: {
      getShowTranslationsEnabled: vi.fn().mockResolvedValue(true),
    },
  } as unknown as GenerateNextPracticeTextDependencies

  return { deps, markFailed, markReady }
}

describe('generateNextPracticeText', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('fails and fences a generated text with no usable annotations instead of surfacing it', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(31_000)
    vi.mocked(generatePracticeText).mockResolvedValue({
      body: 'A fluent generated passage with no highlighted practice targets.',
      usedChunks: [],
      skippedChunks: [],
      generationWarning: 'Dropped 1 bad annotation(s): not in body whitherto|reasons',
    })

    const { deps, markFailed, markReady } = createDeps()
    const result = await generateNextPracticeText(sessionId, userId, deps)

    expect(result).toEqual({
      ok: false,
      reason: 'generation_failed',
      warning: 'generated text had no usable annotations / Dropped 1 bad annotation(s): not in body whitherto|reasons',
    })
    expect(markReady).not.toHaveBeenCalled()
    expect(markFailed).toHaveBeenCalledWith({
      id: slotId,
      token: '00000000-0000-0000-0000-000000000005',
      warning: 'generated text had no usable annotations / Dropped 1 bad annotation(s): not in body whitherto|reasons',
    })
  })
})

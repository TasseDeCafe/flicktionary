import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbUserLookup } from '../../transport/database/user-lookups/user-lookups-repository'
import type { DbPracticeText } from '../../transport/database/practice-texts/practice-texts-repository'
import { advanceReadingText, type AdvanceReadingTextDependencies } from './advance-reading-text'

const userId = '00000000-0000-0000-0000-000000000001'
const textId = '00000000-0000-0000-0000-000000000010'
const nextTextId = '00000000-0000-0000-0000-000000000011'
const laId = '00000000-0000-0000-0000-0000000000aa'
const lbId = '00000000-0000-0000-0000-0000000000bb'

const makeLookup = (id: string, overrides: Partial<DbUserLookup> = {}): DbUserLookup =>
  ({
    id,
    user_id: userId,
    target_language: 'es',
    headword: id,
    sense: 's',
    translation: null,
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
    ...overrides,
  }) as DbUserLookup

const claimedText = {
  id: textId,
  user_id: userId,
  target_language: 'es',
  pool: 'passive',
  ord: 0,
  status: 'done',
  body: 'gato y perro',
  annotations: [
    { headword: laId, sense: 's', surface_form: 'gato', char_start: 0, char_end: 4 },
    { headword: lbId, sense: 's', surface_form: 'perro', char_start: 7, char_end: 12 },
  ],
  skipped_chunks: [],
  generation_warning: null,
  generation_token: null,
  created_at: '2026-05-12T00:00:00Z',
  ready_at: null,
  read_at: null,
} as unknown as DbPracticeText

const nextText = { ...claimedText, id: nextTextId, ord: 1, status: 'reading' } as DbPracticeText

const createDeps = (opts: { claimWins: boolean }) => {
  // la is already scheduled (review); lb is new — so rating both should
  // introduce exactly one term.
  const lookupsByKey: Record<string, DbUserLookup> = {
    [`${laId}::s`]: makeLookup(laId, { srs_state: 'review', srs_due: '2026-05-12T00:00:00Z' }),
    [`${lbId}::s`]: makeLookup(lbId),
  }
  const findByKey = vi.fn(async ({ headword, sense }: { headword: string; sense: string }) => lookupsByKey[`${headword}::${sense}`] ?? null)
  const applyFsrsResultForPool = vi.fn().mockResolvedValue(undefined)
  const initializeSrsStateIfUnderDailyCap = vi.fn().mockResolvedValue(true)
  const claimFinalize = vi.fn().mockResolvedValue(opts.claimWins ? claimedText : null)
  const selectAndMarkReading = vi.fn().mockResolvedValue(nextText)

  const deps = {
    practiceTextsRepository: {
      findByIdForUser: vi.fn().mockResolvedValue({ practiceText: claimedText, targetLanguage: 'es', pool: 'passive' }),
      claimFinalize,
      failMismatchedScopeSlots: vi.fn().mockResolvedValue(undefined),
      selectAndMarkReading,
      reserveOrFindNextSlot: vi.fn(),
      markReading: vi.fn(),
      findById: vi.fn(),
      claimGenerating: vi.fn(),
      markReady: vi.fn(),
      markFailed: vi.fn(),
    },
    userLookupsRepository: {
      findByKey,
      initializeSrsStateIfUnderDailyCap,
      initializeSrsStateForPool: vi.fn(),
      applyFsrsResultForPool,
      listReviewTerms: vi.fn().mockResolvedValue([]),
      listDueSummary: vi.fn().mockResolvedValue([]),
    },
    usersRepository: {
      getNativeLanguage: vi.fn().mockResolvedValue('en'),
      getPracticeSessionLimits: vi.fn().mockResolvedValue({ maxNewTerms: 20, maxReviewTerms: 100 }),
    },
    userTargetLanguagePrefsRepository: {
      getShowTranslationsEnabled: vi.fn().mockResolvedValue(true),
    },
  } as unknown as AdvanceReadingTextDependencies

  return { deps, findByKey, applyFsrsResultForPool, claimFinalize, selectAndMarkReading }
}

describe('advanceReadingText', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('applies the explicit rating to tapped terms and implicit good to the rest, counting introductions', async () => {
    const { deps, applyFsrsResultForPool } = createDeps({ claimWins: true })
    const result = await advanceReadingText(
      userId,
      textId,
      'passive',
      'mixed',
      [{ userLookupId: laId, rating: 'again' }],
      deps
    )
    expect(result).toEqual({ ok: true, done: false, practiceText: nextText, introduced: 1 })
    // Both annotations graded: la (scheduled, no intro) + lb (new, introduced).
    expect(applyFsrsResultForPool).toHaveBeenCalledTimes(2)
  })

  it('is idempotent: a lost finalize claim applies no FSRS and still returns the next text', async () => {
    const { deps, applyFsrsResultForPool, findByKey } = createDeps({ claimWins: false })
    const result = await advanceReadingText(userId, textId, 'passive', 'mixed', [], deps)
    expect(result).toEqual({ ok: true, done: false, practiceText: nextText, introduced: 0 })
    expect(applyFsrsResultForPool).not.toHaveBeenCalled()
    expect(findByKey).not.toHaveBeenCalled()
  })

  it('returns text_not_found when the text is missing or not owned', async () => {
    const { deps } = createDeps({ claimWins: true })
    ;(deps.practiceTextsRepository.findByIdForUser as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const result = await advanceReadingText(userId, textId, 'passive', 'mixed', [], deps)
    expect(result).toEqual({ ok: false, reason: 'text_not_found' })
  })
})

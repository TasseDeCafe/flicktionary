import type { PracticeSessionsRepositoryInterface } from '../../transport/database/practice-sessions/practice-sessions-repository'
import type {
  PracticeTextsRepositoryInterface,
  DbPracticeText,
} from '../../transport/database/practice-texts/practice-texts-repository'
import type { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import type { CardsRepositoryInterface } from '../../transport/database/cards/cards-repository'
import type { L1InterferenceNotesRepositoryInterface } from '../../transport/database/l1-interference-notes/l1-interference-notes-repository'
import type { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import { ensureL1InterferenceNotes } from './ensure-l1-interference-notes'
import { generatePracticeText } from '../../transport/third-party/anthropic/passes/generate-practice-text'

export type GenerateNextPracticeTextDependencies = {
  practiceSessionsRepository: PracticeSessionsRepositoryInterface
  practiceTextsRepository: PracticeTextsRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
  cardsRepository: CardsRepositoryInterface
  l1InterferenceNotesRepository: L1InterferenceNotesRepositoryInterface
  usersRepository: UsersRepositoryInterface
  // Optional override for tests / future CEFR-specific tuning.
  chunksPerText?: number
}

export type GenerateNextPracticeTextResult =
  | { ok: true; done: false; practiceText: DbPracticeText }
  | { ok: true; done: true }
  | {
      ok: false
      reason: 'session_not_found' | 'session_completed' | 'no_native_language' | 'generation_failed'
      warning?: string
    }

const DEFAULT_CHUNKS_PER_TEXT = 7

// Pulls the user's representative card for a given (headword, sense) so the
// generation prompt has translation/example fields. Returns null if the
// user_lookups row's first_card_id is missing or the card was deleted.
const fetchChunkContent = async (
  userId: string,
  targetLanguage: string,
  headword: string,
  sense: string,
  cardsRepository: CardsRepositoryInterface,
  userLookupsRepository: UserLookupsRepositoryInterface
): Promise<{
  headword: string
  sense: string
  translation: string | null
  definition: string | null
  targetExample: string | null
  nativeExample: string | null
} | null> => {
  const lookup = await userLookupsRepository.findByKey({ userId, targetLanguage, headword, sense })
  if (!lookup) return null
  const cardId = lookup.first_card_id
  if (!cardId) return { headword, sense, translation: null, definition: null, targetExample: null, nativeExample: null }
  const card = await cardsRepository.findById(cardId)
  if (!card) return { headword, sense, translation: null, definition: null, targetExample: null, nativeExample: null }
  return {
    headword,
    sense,
    translation: card.translation,
    definition: card.definition,
    targetExample: card.target_example,
    nativeExample: card.native_example,
  }
}

export const generateNextPracticeText = async (
  practiceSessionId: string,
  userId: string,
  deps: GenerateNextPracticeTextDependencies
): Promise<GenerateNextPracticeTextResult> => {
  const session = await deps.practiceSessionsRepository.findByIdForUser(practiceSessionId, userId)
  if (!session) return { ok: false, reason: 'session_not_found' }
  if (session.status !== 'active') return { ok: false, reason: 'session_completed' }

  const nativeLanguage = await deps.usersRepository.getNativeLanguage(userId)
  if (!nativeLanguage) return { ok: false, reason: 'no_native_language' }

  // Build the candidate pool: rows eligible for review, minus rows already
  // covered by earlier texts in this session. We work in JS rather than SQL
  // because the "already covered" set comes from JSONB annotations.
  const eligible = await deps.userLookupsRepository.listEligibleForLanguage({
    userId,
    targetLanguage: session.target_language,
  })
  const covered = await deps.practiceTextsRepository.getCoveredHeadwordSenses(practiceSessionId)
  const coveredKeys = new Set(covered.map((c) => `${c.headword}::${c.sense}`))
  const remaining = eligible.filter((row) => !coveredKeys.has(`${row.headword}::${row.sense}`))

  if (remaining.length === 0) {
    await deps.practiceSessionsRepository.markCompleted(practiceSessionId, userId)
    return { ok: true, done: true }
  }

  // Initialize SRS state on the never-reviewed rows we're about to surface so
  // they enter the queue properly. Idempotent (no-op when srs_state is set).
  const newRows = remaining.filter((row) => row.srs_state == null)
  await Promise.all(
    newRows.map((row) =>
      deps.userLookupsRepository.initializeSrsState({
        userId,
        targetLanguage: session.target_language,
        headword: row.headword,
        sense: row.sense ?? '',
      })
    )
  )

  const chunksPerText = deps.chunksPerText ?? DEFAULT_CHUNKS_PER_TEXT
  const picked = remaining.slice(0, chunksPerText)
  const enriched = await Promise.all(
    picked.map((row) =>
      fetchChunkContent(
        userId,
        session.target_language,
        row.headword,
        row.sense ?? '',
        deps.cardsRepository,
        deps.userLookupsRepository
      )
    )
  )
  const chunks = enriched.filter((c): c is NonNullable<typeof c> => c !== null)
  if (chunks.length === 0) {
    await deps.practiceSessionsRepository.markCompleted(practiceSessionId, userId)
    return { ok: true, done: true }
  }

  // CEFR level for the prompt: walk back from the user_target_language_prefs
  // would be ideal, but the simplest path is to ask the users repo. Since the
  // pref isn't surfaced via the users repo today, we hardcode B1 as the
  // surrounding-text floor (the spec says B1-B2 regardless of chunk level)
  // and let the LLM ride that.
  const cefrLevel = 'B1'

  const l1Notes = await ensureL1InterferenceNotes(
    nativeLanguage,
    session.target_language,
    deps.l1InterferenceNotesRepository
  )

  const ord = await deps.practiceTextsRepository.getNextOrd(practiceSessionId)
  const pending = await deps.practiceTextsRepository.insertPending({
    practiceSessionId,
    ord,
  })
  await deps.practiceTextsRepository.markGenerating(pending.id)

  try {
    const result = await generatePracticeText({
      nativeLanguage,
      targetLanguage: session.target_language,
      cefrLevel,
      l1InterferenceNotes: l1Notes,
      chunks,
    })
    const ready = await deps.practiceTextsRepository.markReady({
      id: pending.id,
      body: result.body,
      annotations: result.usedChunks,
      generationWarning: result.generationWarning,
    })
    if (!ready) {
      return { ok: false, reason: 'generation_failed', warning: 'practice_text disappeared after markReady' }
    }
    return { ok: true, done: false, practiceText: ready }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await deps.practiceTextsRepository.markFailed({ id: pending.id, warning: message })
    return { ok: false, reason: 'generation_failed', warning: message }
  }
}

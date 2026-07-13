import type {
  PracticeTextsRepositoryInterface,
  DbPracticeText,
  ReadingGroup,
} from '../../transport/database/practice-texts/practice-texts-repository'
import type {
  DbUserLookup,
  PracticePool,
  UserLookupsRepositoryInterface,
} from '../../transport/database/user-lookups/user-lookups-repository'
import type { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import type { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import type { PracticeRatingEventsRepositoryInterface } from '../../transport/database/practice-rating-events/practice-rating-events-repository'
import type { ReviewScope } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { type PracticeChunkInput } from '../../transport/third-party/anthropic/passes/generate-practice-text'
import type { AnthropicPassesInterface } from '../../transport/third-party/anthropic/anthropic-passes'
import { getLanguageMode } from '../user-prefs/language-mode'
import { listReviewTerms } from './list-review-terms'
import { CITATION_FORM } from '../../transport/database/study-facets/study-facets-repository'
import type { DbUserLookupWithFacet } from '../../transport/database/user-lookups/user-lookups-repository'

// Reading mode stays CITATION-MEANING-ONLY: the generator embeds a word's
// citation card, and advance-reading-text implicitly rates untapped annotations
// 'good'. It must never weave a pronunciation or specific-form facet, whose
// front isn't the lemma. listReviewTerms can surface those facets (Phase 4), so
// filter candidates down to the citation meaning facet here. In Phase 2 every
// candidate already is one, so this is inert; it also dedupes a term to a single
// citation row.
const isCitationMeaningCandidate = (row: DbUserLookupWithFacet): boolean =>
  row.target_form === CITATION_FORM && (row.skill === 'meaning_recognition' || row.skill === 'meaning_production')

export type GenerateReadingTextDependencies = {
  anthropicPasses: AnthropicPassesInterface
  practiceTextsRepository: PracticeTextsRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
  usersRepository: UsersRepositoryInterface
  userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface
  // Review-budget source for the candidate-set caps (resolveReviewCaps) and
  // the event log written by the reading finalizer's ratings.
  practiceRatingEventsRepository: PracticeRatingEventsRepositoryInterface
  // Optional exercise-bank warmer threaded through to applyTermRating so
  // reading-mode again/hard ratings pre-generate Strengthen exercises too.
  warmExerciseBank?: (params: { lookup: DbUserLookup; pool: PracticePool }) => void
  // Optional override for tests / future CEFR-specific tuning.
  chunksPerText?: number
}

export type GenerateReadingTextResult =
  | { ok: true; done: false; practiceText: DbPracticeText }
  | { ok: true; done: true }
  | { ok: false; reason: 'no_native_language' | 'generation_failed'; warning?: string }

const DEFAULT_CHUNKS_PER_TEXT = 7

// A reserved 'generating' slot owned by another worker (pre-gen) is polled this
// long before we give up and regenerate a fresh slot. Common case at advance
// time is the pre-gen has already finished ('ready'), so this rarely fires.
const GENERATING_POLL_TIMEOUT_MS = 30_000
const GENERATING_POLL_INTERVAL_MS = 500

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const toChunkInput = (row: DbUserLookup): PracticeChunkInput => ({
  headword: row.headword,
  sense: row.sense ?? '',
  translation: row.translation,
  definition: row.definition,
  targetExample: row.target_example,
  nativeExample: row.native_example,
})

// Run the LLM call against a reserved slot, claiming it via fencing token.
// Unlike the old session generator this does NOT initialize SRS state — term
// introduction happens at rate/advance time only.
const runGenerationForSlot = async (params: {
  slotId: string
  candidates: DbUserLookup[]
  nativeLanguage: string
  targetLanguage: string
  hideTranslationFields: boolean
  allowL1Notes: boolean
  chunksPerText: number
  deps: GenerateReadingTextDependencies
}): Promise<{ ok: true; practiceText: DbPracticeText } | { ok: false; warning: string }> => {
  const claim = await params.deps.practiceTextsRepository.claimGenerating(params.slotId)
  if (!claim) return { ok: false, warning: 'slot already claimed' }

  const chunks = params.candidates.slice(0, params.chunksPerText).map(toChunkInput)
  if (chunks.length === 0) {
    await params.deps.practiceTextsRepository.markFailed({
      id: params.slotId,
      token: claim.token,
      warning: 'no candidate chunks at generation time',
    })
    return { ok: false, warning: 'no candidate chunks' }
  }

  try {
    const result = await params.deps.anthropicPasses.generatePracticeText({
      nativeLanguage: params.nativeLanguage,
      targetLanguage: params.targetLanguage,
      cefrLevel: 'B1',
      chunks,
      hideTranslationFields: params.hideTranslationFields,
      allowL1Notes: params.allowL1Notes,
    })
    if (result.usedChunks.length === 0) {
      const warning = ['generated text had no usable annotations', result.generationWarning]
        .filter((w): w is string => w != null && w.length > 0)
        .join(' / ')
      await params.deps.practiceTextsRepository.markFailed({ id: params.slotId, token: claim.token, warning })
      return { ok: false, warning }
    }
    // Stamp each annotation with its user_lookups id so readers survive a
    // mid-text rename of the (headword, sense) key. The pass only keeps chunks
    // it was asked to embed, so every used chunk maps back to a candidate.
    const idByKey = new Map(params.candidates.map((c) => [`${c.headword}::${c.sense ?? ''}`, c.id]))
    const annotations = result.usedChunks.map((a) => ({
      ...a,
      userLookupId: idByKey.get(`${a.headword}::${a.sense ?? ''}`) ?? null,
    }))
    const ready = await params.deps.practiceTextsRepository.markReady({
      id: params.slotId,
      token: claim.token,
      body: result.body,
      annotations,
      skippedChunks: result.skippedChunks.map((s) => ({ headword: s.headword, sense: s.sense, reason: s.reason })),
      generationWarning: result.generationWarning,
    })
    if (!ready) return { ok: false, warning: 'fenced out by takeover' }
    return { ok: true, practiceText: ready }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await params.deps.practiceTextsRepository.markFailed({ id: params.slotId, token: claim.token, warning: message })
    return { ok: false, warning: message }
  }
}

const pollUntilReady = async (
  slotId: string,
  deadline: number,
  deps: GenerateReadingTextDependencies
): Promise<DbPracticeText | null> => {
  while (Date.now() < deadline) {
    await sleep(GENERATING_POLL_INTERVAL_MS)
    const row = await deps.practiceTextsRepository.findById(slotId)
    if (!row) return null
    if (row.status === 'ready' || row.status === 'failed' || row.status === 'done') return row
  }
  return null
}

export type ResolvedLanguagePrefs = {
  nativeLanguage: string
  hideTranslationFields: boolean
  allowL1Notes: boolean
}

// Shared "surface the next readable text" path used by both the generate
// endpoint (initial / resume) and advanceReadingText (after finalize). Consumes
// an in-progress 'reading' row or a pre-generated 'ready' slot when present;
// otherwise generates synchronously from the scope-filtered candidate set.
export const produceNextReadable = async (params: {
  group: ReadingGroup
  scope: ReviewScope
  langPrefs: ResolvedLanguagePrefs
  // Lets advanceReadingText drop the just-rated terms (they may not have left
  // the live due window yet) and the pre-gen path exclude in-flight terms.
  excludeUserLookupIds?: string[]
  deps: GenerateReadingTextDependencies
}): Promise<GenerateReadingTextResult> => {
  const { group, scope, langPrefs, deps } = params
  const exclude = new Set(params.excludeUserLookupIds ?? [])
  const chunksPerText = deps.chunksPerText ?? DEFAULT_CHUNKS_PER_TEXT
  const startedAt = Date.now()

  // Discard any in-progress / speculative text built for a different scope
  // before resuming — otherwise entering e.g. "Learn new" would surface a
  // leftover mixed text. Must run before selectAndMarkReading / reserve.
  await deps.practiceTextsRepository.failMismatchedScopeSlots(group, scope)

  // Resume an in-progress reading text or consume a ready pre-gen slot.
  const existing = await deps.practiceTextsRepository.selectAndMarkReading(group)
  if (existing) return { ok: true, done: false, practiceText: existing }

  for (;;) {
    const candidates = (
      await listReviewTerms(group.userId, group.targetLanguage, group.pool, scope, deps, {
        excludeCurrentReadingTerms: true,
      })
    ).filter((row) => isCitationMeaningCandidate(row) && !exclude.has(row.id))
    if (candidates.length === 0) return { ok: true, done: true }

    const slot = await deps.practiceTextsRepository.reserveOrFindNextSlot(group, scope)

    if (slot.practiceText.status === 'ready') {
      const reading = await deps.practiceTextsRepository.markReading(slot.practiceText.id)
      return { ok: true, done: false, practiceText: reading ?? slot.practiceText }
    }

    if (slot.isFresh || slot.practiceText.status === 'pending') {
      const result = await runGenerationForSlot({
        slotId: slot.practiceText.id,
        candidates,
        nativeLanguage: langPrefs.nativeLanguage,
        targetLanguage: group.targetLanguage,
        hideTranslationFields: langPrefs.hideTranslationFields,
        allowL1Notes: langPrefs.allowL1Notes,
        chunksPerText,
        deps,
      })
      if (result.ok) {
        const reading = await deps.practiceTextsRepository.markReading(result.practiceText.id)
        return { ok: true, done: false, practiceText: reading ?? result.practiceText }
      }
      if (Date.now() - startedAt > GENERATING_POLL_TIMEOUT_MS) {
        return { ok: false, reason: 'generation_failed', warning: result.warning }
      }
      continue
    }

    // status === 'generating' — a pre-gen worker owns it. Wait for it.
    const refreshed = await pollUntilReady(slot.practiceText.id, startedAt + GENERATING_POLL_TIMEOUT_MS, deps)
    if (refreshed && refreshed.status === 'ready') {
      const reading = await deps.practiceTextsRepository.markReading(refreshed.id)
      return { ok: true, done: false, practiceText: reading ?? refreshed }
    }
    if (refreshed && (refreshed.status === 'failed' || refreshed.status === 'done')) continue
    // Timed out. Fence the slot off (token-less) and let the next loop reserve
    // a fresh one. The in-flight worker's markReady fails its own token check.
    await deps.practiceTextsRepository.markFailed({
      id: slot.practiceText.id,
      token: null,
      warning: 'foreground takeover after timeout',
    })
  }
}

// Resolve language prefs once; shared by generate + advance + prepare.
export const resolveLanguagePrefs = async (
  userId: string,
  targetLanguage: string,
  deps: GenerateReadingTextDependencies
): Promise<ResolvedLanguagePrefs | null> => {
  const languagePrefs = await getLanguageMode({
    userId,
    targetLanguage,
    usersRepository: deps.usersRepository,
    targetLanguagePrefsRepository: deps.userTargetLanguagePrefsRepository,
  })
  if (!languagePrefs.nativeLanguage) return null
  return {
    nativeLanguage: languagePrefs.nativeLanguage,
    hideTranslationFields: languagePrefs.hideTranslationFields,
    allowL1Notes: languagePrefs.allowL1Notes,
  }
}

// Foreground entry point for the `generate` endpoint: bootstrap or resume the
// current reading text for a (user, language, pool).
export const generateReadingText = async (
  userId: string,
  targetLanguage: string,
  pool: PracticePool,
  scope: ReviewScope,
  deps: GenerateReadingTextDependencies
): Promise<GenerateReadingTextResult> => {
  const langPrefs = await resolveLanguagePrefs(userId, targetLanguage, deps)
  if (!langPrefs) return { ok: false, reason: 'no_native_language' }
  return produceNextReadable({ group: { userId, targetLanguage, pool }, scope, langPrefs, deps })
}

// Background pre-generation. Reserves the next slot if one is needed and kicks
// off generation in a detached promise. Never marks anything reading — that's
// the foreground's job. `excludeUserLookupIds` keeps the currently-reading
// text's terms out of the pre-gen so it doesn't re-embed words about to be
// rated by the pending advance.
export const prepareNextReadingText = async (
  userId: string,
  targetLanguage: string,
  pool: PracticePool,
  scope: ReviewScope,
  excludeUserLookupIds: string[],
  deps: GenerateReadingTextDependencies
): Promise<
  | { ok: true; status: 'queued' | 'already_ready' | 'already_generating'; practiceTextId: string }
  | { ok: true; status: 'no_work' }
  | { ok: false; reason: 'no_native_language' }
> => {
  const langPrefs = await resolveLanguagePrefs(userId, targetLanguage, deps)
  if (!langPrefs) return { ok: false, reason: 'no_native_language' }

  const group: ReadingGroup = { userId, targetLanguage, pool }
  const exclude = new Set(excludeUserLookupIds)
  const candidates = (
    await listReviewTerms(userId, targetLanguage, pool, scope, deps, { excludeCurrentReadingTerms: true })
  ).filter((row) => isCitationMeaningCandidate(row) && !exclude.has(row.id))
  if (candidates.length === 0) return { ok: true, status: 'no_work' }

  // Don't let the pre-gen latch onto a slot left over from a different scope.
  await deps.practiceTextsRepository.failMismatchedScopeSlots(group, scope)

  const slot = await deps.practiceTextsRepository.reserveOrFindNextSlot(group, scope)
  if (slot.practiceText.status === 'ready') {
    return { ok: true, status: 'already_ready', practiceTextId: slot.practiceText.id }
  }
  if (!slot.isFresh && slot.practiceText.status === 'generating') {
    return { ok: true, status: 'already_generating', practiceTextId: slot.practiceText.id }
  }

  const chunksPerText = deps.chunksPerText ?? DEFAULT_CHUNKS_PER_TEXT
  void runGenerationForSlot({
    slotId: slot.practiceText.id,
    candidates,
    nativeLanguage: langPrefs.nativeLanguage,
    targetLanguage,
    hideTranslationFields: langPrefs.hideTranslationFields,
    allowL1Notes: langPrefs.allowL1Notes,
    chunksPerText,
    deps,
  })
    .then((result) => {
      if (!result.ok)
        console.warn('reading pre-gen reported failure', { slotId: slot.practiceText.id, warning: result.warning })
    })
    .catch((err) => console.error('reading pre-gen threw', { slotId: slot.practiceText.id, err }))

  return { ok: true, status: 'queued', practiceTextId: slot.practiceText.id }
}

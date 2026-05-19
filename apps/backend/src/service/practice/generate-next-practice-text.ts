import type { PracticeSessionsRepositoryInterface } from '../../transport/database/practice-sessions/practice-sessions-repository'
import type { PracticeRatingsRepositoryInterface } from '../../transport/database/practice-ratings/practice-ratings-repository'
import type {
  PracticeTextsRepositoryInterface,
  DbPracticeText,
} from '../../transport/database/practice-texts/practice-texts-repository'
import type { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import type { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import { generatePracticeText } from '../../transport/third-party/anthropic/passes/generate-practice-text'
import { getEffectiveNativeLanguage } from '../user-prefs/effective-native-language'

export type GenerateNextPracticeTextDependencies = {
  practiceSessionsRepository: PracticeSessionsRepositoryInterface
  practiceTextsRepository: PracticeTextsRepositoryInterface
  practiceRatingsRepository: PracticeRatingsRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
  usersRepository: UsersRepositoryInterface
  // Optional override for tests / future CEFR-specific tuning.
  chunksPerText?: number
}

export type GenerateNextPracticeTextResult =
  | { ok: true; done: false; practiceText: DbPracticeText; targetLanguage: string }
  | { ok: true; done: true }
  | { ok: true; queued: true; practiceText: DbPracticeText }
  | {
      ok: false
      reason: 'session_not_found' | 'session_completed' | 'no_native_language' | 'generation_failed'
      warning?: string
    }

const DEFAULT_CHUNKS_PER_TEXT = 7

// Stubborn-chunk policy: a chunk skipped once gets a one-shot single-sentence
// rescue. Skipped twice and we give up for the rest of the session — we stamp
// abandoned_at on the membership row so the progress numerator includes it,
// and the chunk stays in user_lookups with its existing srs_due so it
// resurfaces in a future session.
const RESCUE_THRESHOLD = 1
const ABANDON_THRESHOLD = 2

// Foreground polling cap when we land on a slot somebody else is already
// generating. After this we take over (token-fenced).
const FOREGROUND_POLL_TIMEOUT_MS = 30_000
const FOREGROUND_POLL_INTERVAL_MS = 500

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// Pulls the canonical content for a given (headword, sense) so the generation
// prompt has translation/example fields. After the content refactor this lives
// on user_lookups directly — no card join required.
const fetchChunkContent = async (
  userId: string,
  targetLanguage: string,
  headword: string,
  sense: string,
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
  return {
    headword,
    sense,
    translation: lookup.translation,
    definition: lookup.definition,
    targetExample: lookup.target_example,
    nativeExample: lookup.native_example,
  }
}

// Compute the set of (headword, sense) pairs that should drive the next text:
// frozen membership minus already-covered minus abandoned, plus stubborn
// (Problem 3 — chunks the user just rated 'again' resurface in-session). Also
// stamps abandoned_at on chunks the LLM has skipped twice.
const buildRemainingChunks = async (
  practiceSessionId: string,
  userId: string,
  targetLanguage: string,
  deps: GenerateNextPracticeTextDependencies
) => {
  const stubbornIds = await deps.practiceRatingsRepository.getStubbornUserLookupIdsForSession(practiceSessionId)

  const eligible = await deps.userLookupsRepository.listEligibleForLanguage({
    userId,
    targetLanguage,
    practiceSessionId,
    extraUserLookupIds: stubbornIds,
  })

  const covered = await deps.practiceTextsRepository.getCoveredHeadwordSenses(practiceSessionId)
  const coveredKeys = new Set(covered.map((c) => `${c.headword}::${c.sense}`))
  // Stubborn chunks were "covered" by the same text the user rated 'again'
  // on; subtract them from the covered set so they resurface.
  const stubbornIdSet = new Set(stubbornIds)

  const skippedCounts = await deps.practiceTextsRepository.getSkippedChunkCountsForSession(practiceSessionId)
  const skipCountByKey = new Map(skippedCounts.map((s) => [`${s.headword}::${s.sense}`, s.count]))

  // Stamp abandoned_at for any chunk that hit the abandon threshold. Idempotent.
  await Promise.all(
    eligible
      .filter((row) => (skipCountByKey.get(`${row.headword}::${row.sense ?? ''}`) ?? 0) >= ABANDON_THRESHOLD)
      .map((row) =>
        deps.practiceSessionsRepository.markChunkAbandoned({
          practiceSessionId,
          userLookupId: row.id,
        })
      )
  )

  const remaining = eligible.filter((row) => {
    const key = `${row.headword}::${row.sense ?? ''}`
    if (coveredKeys.has(key) && !stubbornIdSet.has(row.id)) return false
    if ((skipCountByKey.get(key) ?? 0) >= ABANDON_THRESHOLD) return false
    return true
  })

  return { remaining, skipCountByKey }
}

// Run the LLM call against a reserved slot, claiming it via fencing token.
// Returns the post-update row on success, or marks the slot failed on error.
const runGenerationForSlot = async (params: {
  slotId: string
  practiceSessionId: string
  userId: string
  targetLanguage: string
  nativeLanguage: string
  deps: GenerateNextPracticeTextDependencies
}): Promise<{ ok: true; practiceText: DbPracticeText } | { ok: false; warning: string }> => {
  const { slotId, practiceSessionId, userId, targetLanguage, nativeLanguage, deps } = params

  const claim = await deps.practiceTextsRepository.claimGenerating(slotId)
  if (!claim) {
    // Another worker already moved this slot. The caller should poll/retry.
    return { ok: false, warning: 'slot already claimed' }
  }

  const { remaining, skipCountByKey } = await buildRemainingChunks(practiceSessionId, userId, targetLanguage, deps)
  if (remaining.length === 0) {
    await deps.practiceTextsRepository.markFailed({
      id: slotId,
      token: claim.token,
      warning: 'no remaining chunks at generation time',
    })
    return { ok: false, warning: 'no remaining chunks' }
  }

  const newRows = remaining.filter((row) => row.srs_state == null)
  await Promise.all(newRows.map((row) => deps.userLookupsRepository.initializeSrsState(row.id)))

  const stubborn = remaining.find(
    (row) => (skipCountByKey.get(`${row.headword}::${row.sense ?? ''}`) ?? 0) === RESCUE_THRESHOLD
  )
  const rescueMode = stubborn != null
  const chunksPerText = deps.chunksPerText ?? DEFAULT_CHUNKS_PER_TEXT
  const picked = rescueMode ? [stubborn!] : remaining.slice(0, chunksPerText)
  const enriched = await Promise.all(
    picked.map((row) =>
      fetchChunkContent(userId, targetLanguage, row.headword, row.sense ?? '', deps.userLookupsRepository)
    )
  )
  const chunks = enriched.filter((c): c is NonNullable<typeof c> => c !== null)
  if (chunks.length === 0) {
    await deps.practiceTextsRepository.markFailed({
      id: slotId,
      token: claim.token,
      warning: 'all picked chunks missing user_lookups content',
    })
    return { ok: false, warning: 'no enriched chunks' }
  }

  const cefrLevel = 'B1'
  try {
    const result = await generatePracticeText({
      nativeLanguage,
      targetLanguage,
      cefrLevel,
      chunks,
      rescueMode,
    })
    if (result.usedChunks.length === 0) {
      const warning = ['generated text had no usable annotations', result.generationWarning]
        .filter((w): w is string => w != null && w.length > 0)
        .join(' / ')
      await deps.practiceTextsRepository.markFailed({
        id: slotId,
        token: claim.token,
        warning,
      })
      return { ok: false, warning }
    }
    const annotatedWarning = rescueMode
      ? [`Rescue: ${chunks[0]!.headword}|${chunks[0]!.sense}`, result.generationWarning].filter(Boolean).join(' / ') ||
        null
      : result.generationWarning
    const ready = await deps.practiceTextsRepository.markReady({
      id: slotId,
      token: claim.token,
      body: result.body,
      annotations: result.usedChunks,
      skippedChunks: result.skippedChunks.map((s) => ({ headword: s.headword, sense: s.sense, reason: s.reason })),
      generationWarning: annotatedWarning,
    })
    if (!ready) {
      // Token mismatch — takeover already fenced us off. Caller's poll will
      // discover the new slot.
      return { ok: false, warning: 'fenced out by takeover' }
    }
    return { ok: true, practiceText: ready }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await deps.practiceTextsRepository.markFailed({ id: slotId, token: claim.token, warning: message })
    return { ok: false, warning: message }
  }
}

// Foreground entry point: ensure the next text exists and return it. Reuses a
// pre-generated 'ready' slot when available; polls and takes over otherwise.
//
// `markCompletedOnEmpty` controls whether an empty-pool result transitions
// the session to 'completed'. The foreground path defaults true. The pre-gen
// path passes false — pre-gen running concurrently with the user reading
// the last text must not preempt the foreground's completion call.
export const generateNextPracticeText = async (
  practiceSessionId: string,
  userId: string,
  deps: GenerateNextPracticeTextDependencies,
  options?: { markCompletedOnEmpty?: boolean }
): Promise<GenerateNextPracticeTextResult> => {
  const markCompletedOnEmpty = options?.markCompletedOnEmpty ?? true
  const session = await deps.practiceSessionsRepository.findByIdForUser(practiceSessionId, userId)
  if (!session) return { ok: false, reason: 'session_not_found' }
  if (session.status !== 'active') return { ok: false, reason: 'session_completed' }

  const targetLanguage = session.target_language

  const languagePrefs = await getEffectiveNativeLanguage({
    userId,
    targetLanguage,
    usersRepository: deps.usersRepository,
  })
  if (!languagePrefs.nativeLanguage) return { ok: false, reason: 'no_native_language' }

  const startedAt = Date.now()
  // Loop on takeover. Each iteration: reserve-or-find -> short-circuit if
  // 'ready' -> poll if 'pending'/'generating' -> if poll times out, fence the
  // slot off and let the next iteration reserve fresh.
  for (;;) {
    const { remaining } = await buildRemainingChunks(practiceSessionId, userId, targetLanguage, deps)
    if (remaining.length === 0) {
      if (markCompletedOnEmpty) {
        await deps.practiceSessionsRepository.markCompleted(practiceSessionId, userId)
      }
      return { ok: true, done: true }
    }

    const slot = await deps.practiceTextsRepository.reserveOrFindNextSlot(practiceSessionId)

    if (slot.practiceText.status === 'ready') {
      const reading = await deps.practiceTextsRepository.markReading(slot.practiceText.id)
      return { ok: true, done: false, practiceText: reading ?? slot.practiceText, targetLanguage }
    }

    if (slot.isFresh || slot.practiceText.status === 'pending') {
      const result = await runGenerationForSlot({
        slotId: slot.practiceText.id,
        practiceSessionId,
        userId,
        targetLanguage,
        nativeLanguage: languagePrefs.nativeLanguage,
        deps,
      })
      if (result.ok) {
        const reading = await deps.practiceTextsRepository.markReading(result.practiceText.id)
        return { ok: true, done: false, practiceText: reading ?? result.practiceText, targetLanguage }
      }
      // Slot either got fenced out from under us or the LLM failed. If we
      // still have time, try again; otherwise propagate.
      if (Date.now() - startedAt > FOREGROUND_POLL_TIMEOUT_MS) {
        return { ok: false, reason: 'generation_failed', warning: result.warning }
      }
      continue
    }

    // status === 'generating' — somebody else is working on it. Poll until
    // it flips, or we time out and take over.
    const refreshed = await pollUntilReady({
      slotId: slot.practiceText.id,
      deadline: startedAt + FOREGROUND_POLL_TIMEOUT_MS,
      deps,
    })
    if (refreshed && refreshed.status === 'ready') {
      const reading = await deps.practiceTextsRepository.markReading(refreshed.id)
      return { ok: true, done: false, practiceText: reading ?? refreshed, targetLanguage }
    }
    if (refreshed && (refreshed.status === 'failed' || refreshed.status === 'done')) {
      // Move on; loop will reserve a fresh slot.
      continue
    }
    // Timed out. Fence the slot off and reserve fresh. We pass token=null so
    // markFailed doesn't gate on ownership — the in-flight worker's eventual
    // markReady will fail its own token check.
    await deps.practiceTextsRepository.markFailed({
      id: slot.practiceText.id,
      token: null,
      warning: 'foreground takeover after timeout',
    })
    // Loop again; the failed slot is now ineligible and reserveOrFindNextSlot
    // will pick the next ord.
  }
}

const pollUntilReady = async (params: {
  slotId: string
  deadline: number
  deps: GenerateNextPracticeTextDependencies
}): Promise<DbPracticeText | null> => {
  const { slotId, deadline, deps } = params
  while (Date.now() < deadline) {
    await sleep(FOREGROUND_POLL_INTERVAL_MS)
    const row = await deps.practiceTextsRepository.findById(slotId)
    if (!row) return null
    if (row.status === 'ready' || row.status === 'failed' || row.status === 'done') return row
  }
  return null
}

// Background pre-gen: reserve the next slot if one is needed, kick off
// generation in a detached promise. Returns the (possibly already existing)
// slot row so the router can shape a response. Critically does NOT mark the
// session completed when the pool is empty — that's the foreground's job.
export const prepareNextPracticeText = async (
  practiceSessionId: string,
  userId: string,
  deps: GenerateNextPracticeTextDependencies
): Promise<
  | { ok: true; queued: true; practiceText: DbPracticeText }
  | { ok: true; alreadyReady: true; practiceText: DbPracticeText }
  | { ok: true; alreadyGenerating: true; practiceText: DbPracticeText }
  | { ok: true; noWork: true }
  | { ok: false; reason: 'session_not_found' | 'session_completed' | 'no_native_language' }
> => {
  const session = await deps.practiceSessionsRepository.findByIdForUser(practiceSessionId, userId)
  if (!session) return { ok: false, reason: 'session_not_found' }
  if (session.status !== 'active') return { ok: false, reason: 'session_completed' }

  const targetLanguage = session.target_language

  const languagePrefs = await getEffectiveNativeLanguage({
    userId,
    targetLanguage,
    usersRepository: deps.usersRepository,
  })
  if (!languagePrefs.nativeLanguage) return { ok: false, reason: 'no_native_language' }

  const { remaining } = await buildRemainingChunks(practiceSessionId, userId, targetLanguage, deps)
  if (remaining.length === 0) {
    return { ok: true, noWork: true }
  }

  const slot = await deps.practiceTextsRepository.reserveOrFindNextSlot(practiceSessionId)
  if (slot.practiceText.status === 'ready') {
    return { ok: true, alreadyReady: true, practiceText: slot.practiceText }
  }
  if (!slot.isFresh && slot.practiceText.status === 'generating') {
    return { ok: true, alreadyGenerating: true, practiceText: slot.practiceText }
  }

  // Fire and forget. Errors are logged; the slot transitions to 'failed' on
  // the worker side and the next foreground call will reserve fresh.
  void runGenerationForSlot({
    slotId: slot.practiceText.id,
    practiceSessionId,
    userId,
    targetLanguage,
    nativeLanguage: languagePrefs.nativeLanguage,
    deps,
  })
    .then((result) => {
      if (!result.ok) {
        console.warn('pre-gen worker reported failure', { slotId: slot.practiceText.id, warning: result.warning })
      }
    })
    .catch((err) => {
      console.error('pre-gen worker threw', { slotId: slot.practiceText.id, err })
    })

  return { ok: true, queued: true, practiceText: slot.practiceText }
}

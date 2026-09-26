import { getWordRanges } from '@flicktionary/core/dom/word-segmenter'
import { foldCheckpointToken } from '@flicktionary/core/utils/checkpoint-fold'
import { KAIKKI_LANGUAGES } from '@flicktionary/core/constants/language-grammar'
import { isBookReady, type BooksRepositoryInterface } from '../../transport/database/books/books-repository'
import type {
  BookPrelearnRepositoryInterface,
  DbPrelearnGloss,
  PrelearnHorizon,
} from '../../transport/database/book-prelearn/book-prelearn-repository'
import type { TextSegmentsRepositoryInterface } from '../../transport/database/text-segments/text-segments-repository'
import type { TextTrackLemmaProfilesRepositoryInterface } from '../../transport/database/text-track-lemma-profiles/text-track-lemma-profiles-repository'
import type { LemmaRanksRepositoryInterface } from '../../transport/database/lemma-ranks/lemma-ranks-repository'
import type { WiktionaryMatchRepositoryInterface } from '../../transport/database/wiktionary-entries/wiktionary-match-repository'
import type { KnownLemmasRepositoryInterface } from '../../transport/database/known-lemmas/known-lemmas-repository'
import type { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import type { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import type { AnthropicPassesInterface } from '../../transport/third-party/anthropic/anthropic-passes'
import { logCustomErrorMessageAndError, logMessage } from '../../transport/error-monitoring/error-monitoring'
import {
  applyFrequencyAsymmetryGuard,
  isDigitHyphenCompoundPiece,
  windowAroundRange,
} from '../checkpoint/checkpoint-matching'
import { lemmasNeedingRanks, mostLikelyReading } from '../lemma-profiles/book-lemma-counts'
import { getLanguageMode } from '../user-prefs/language-mode'
import { createAdhocCard, type CreateAdhocCardDependencies } from '../adhoc/create-adhoc-card'

// "Learn before you read" (docs/READER-SPEC.md, book page): frequent words in
// the chapters ahead that the user neither knows nor has saved. Each row
// carries the word's first occurrence after the reading position — shown as
// evidence, glossed in that sentence, and used as a "Learn" card's context so
// the card gets the sense the book uses.

export const PRELEARN_LIST_LIMIT = 30
// Headroom over the list size: a candidate whose every occurrence turns out
// to be behind the reader (pro-rating overestimates what's left of the
// current part) is dropped, and the next one takes its place.
const CANDIDATE_OVERFETCH = 10
const SEGMENT_PAGE_SIZE = 500

export type BookPrelearnDependencies = {
  booksRepository: BooksRepositoryInterface
  bookPrelearnRepository: BookPrelearnRepositoryInterface
  textSegmentsRepository: TextSegmentsRepositoryInterface
  textTrackLemmaProfilesRepository: TextTrackLemmaProfilesRepositoryInterface
  lemmaRanksRepository: LemmaRanksRepositoryInterface
  wiktionaryMatchRepository: WiktionaryMatchRepositoryInterface
  knownLemmasRepository: KnownLemmasRepositoryInterface
  usersRepository: UsersRepositoryInterface
  userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface
  anthropicPasses: AnthropicPassesInterface
  createAdhocCardDependencies: CreateAdhocCardDependencies
}

export type PrelearnOccurrence = { segmentId: string; surface: string; context: string }

// A word capitalized mid-sentence is almost always part of a name («Перси»,
// «Волан-де-Морт», «Лорд»): the dictionary knows «перси» and «волан» as words,
// so only the text can tell. After this many name-like sightings with no
// ordinary one, the lemma is dropped from the list.
export const NAME_LIKE_SIGHTINGS_TO_DROP = 3

// Languages that capitalize ordinary words mid-sentence (German nouns).
const CAPITALIZES_COMMON_WORDS = new Set(['de'])

// Opening punctuation that may sit between a sentence boundary and its first word.
const SENTENCE_OPENERS = /[\s«»"„“”'‘’(\[—–-]/u
const SENTENCE_ENDS = /[.!?…:;]/u

export type Capitalization = 'lower' | 'sentence_start' | 'mid_sentence'

// How the word starting at `start` is capitalized: a capital is
// 'sentence_start' at the segment start or after sentence-ending punctuation
// and any opening quotes/dashes (dialogue lines open with «— »), otherwise
// 'mid_sentence'.
export const capitalizationAt = (text: string, start: number): Capitalization => {
  const first = text[start] ?? ''
  if (first === first.toLowerCase()) return 'lower'
  let i = start - 1
  while (i >= 0 && SENTENCE_OPENERS.test(text[i]!)) i -= 1
  return i >= 0 && !SENTENCE_ENDS.test(text[i]!) ? 'mid_sentence' : 'sentence_start'
}

export type OccurrenceScanState = {
  // First lowercase sighting per lemma — final.
  found: Map<string, PrelearnOccurrence>
  // First sentence-initial sighting: a name can open a sentence too
  // («— Волан-де-Морт вернулся»), so it is only used when the scan ends
  // without a lowercase sighting and without the lemma being dropped.
  fallback: Map<string, PrelearnOccurrence>
  // Mid-sentence capitalized sightings per lemma; a lemma reaching
  // NAME_LIKE_SIGHTINGS_TO_DROP before any lowercase sighting is dropped.
  nameLikeSightings: Map<string, number>
}

export const newOccurrenceScanState = (): OccurrenceScanState => ({
  found: new Map(),
  fallback: new Map(),
  nameLikeSightings: new Map(),
})

// The scan's result: lowercase sightings, else sentence-initial ones for
// lemmas never dropped as name-like.
export const finishOccurrenceScan = (state: OccurrenceScanState): Map<string, PrelearnOccurrence> => {
  const result = new Map(state.found)
  for (const [lemma, occurrence] of state.fallback) {
    if (isStillWanted(state, lemma)) result.set(lemma, occurrence)
  }
  return result
}

// Whether the scan still needs to look for `lemma`.
export const isStillWanted = (state: OccurrenceScanState, lemma: string): boolean =>
  !state.found.has(lemma) && (state.nameLikeSightings.get(lemma) ?? 0) < NAME_LIKE_SIGHTINGS_TO_DROP

// Records, into `state`, the sightings of each wanted lemma in `segments`
// (reading order) until its first lowercase one. A token counts only if
// `lemmasByToken` — the homograph-guarded readings — maps it to the lemma: an
// earlier «при» never stands in for «переть». Digit-hyphen compound pieces
// are skipped like everywhere occurrences are counted. Capitalized sightings
// are only a fallback (sentence start) or a name signal (mid-sentence).
// Stops as soon as no wanted lemma is left.
export const scanFirstOccurrences = (
  segments: ReadonlyArray<{ id: string; text: string }>,
  lemmasByToken: ReadonlyMap<string, ReadonlySet<string>>,
  wanted: ReadonlySet<string>,
  targetLanguage: string,
  state: OccurrenceScanState
): void => {
  const detectNames = !CAPITALIZES_COMMON_WORDS.has(targetLanguage)
  let remaining = [...wanted].filter((lemma) => isStillWanted(state, lemma)).length
  if (remaining === 0) return
  for (const segment of segments) {
    for (const [start, end] of getWordRanges(segment.text, targetLanguage)) {
      if (isDigitHyphenCompoundPiece(segment.text, start)) continue
      const lemmas = lemmasByToken.get(foldCheckpointToken(segment.text.slice(start, end), targetLanguage))
      if (!lemmas) continue
      const capitalization = detectNames ? capitalizationAt(segment.text, start) : 'lower'
      for (const lemma of lemmas) {
        if (!wanted.has(lemma) || !isStillWanted(state, lemma)) continue
        const occurrence = {
          segmentId: segment.id,
          surface: segment.text.slice(start, end),
          context: windowAroundRange(segment.text, start, end),
        }
        if (capitalization === 'mid_sentence') {
          state.nameLikeSightings.set(lemma, (state.nameLikeSightings.get(lemma) ?? 0) + 1)
          if (!isStillWanted(state, lemma)) remaining -= 1
          continue
        }
        if (capitalization === 'sentence_start') {
          if (!state.fallback.has(lemma)) state.fallback.set(lemma, occurrence)
          continue
        }
        state.found.set(lemma, occurrence)
        remaining -= 1
      }
      if (remaining === 0) return
    }
  }
}

// Folded token → the wanted lemma it most likely realizes after the homograph
// guard, for one part. Built from the part's profile groups with the same rule
// as the primary counts the list is ranked on, so the evidence sentence is one
// where the word most likely means what the list says.
const guardedTokensForPart = async (
  params: { textTrackId: string; targetLanguage: string; lemmas: readonly string[] },
  deps: BookPrelearnDependencies
): Promise<Map<string, Set<string>>> => {
  const rows = await deps.textTrackLemmaProfilesRepository.listRowsForLemmas({
    textTrackId: params.textTrackId,
    lemmas: params.lemmas,
  })
  const groups = rows.map((row) => ({
    foldedToken: row.folded_token,
    tokenCount: row.token_count,
    candidateLemmas: row.candidate_lemmas,
  }))
  const rankLemmas = lemmasNeedingRanks(groups)
  const ranks =
    rankLemmas.length > 0
      ? await deps.lemmaRanksRepository.listRanksForLemmas({
          targetLanguage: params.targetLanguage,
          lemmas: rankLemmas,
        })
      : new Map()
  const guarded = applyFrequencyAsymmetryGuard(
    new Map(groups.map((group) => [group.foldedToken, new Set(group.candidateLemmas)])),
    ranks
  )
  const wanted = new Set(params.lemmas)
  const result = new Map<string, Set<string>>()
  for (const [token, lemmas] of guarded) {
    if (lemmas.size === 0) continue
    const primary = mostLikelyReading([...lemmas], ranks)
    if (wanted.has(primary)) result.set(token, new Set([primary]))
  }
  return result
}

// Scans forward from the reading position, part by part, until every lemma
// has an ordinary occurrence or was dropped as name-like. Each lemma is only
// looked for in parts that count it.
const findOccurrencesAhead = async (
  params: {
    contentSourceId: string
    targetLanguage: string
    lemmas: readonly string[]
    position: { partIndex: number; afterSegmentIndex: number | null }
  },
  deps: BookPrelearnDependencies
): Promise<Map<string, PrelearnOccurrence>> => {
  const lemmaParts = await deps.bookPrelearnRepository.listLemmaParts({
    contentSourceId: params.contentSourceId,
    lemmas: params.lemmas,
    fromPartIndex: params.position.partIndex,
  })
  const parts = new Map<string, { partIndex: number; lemmas: string[] }>()
  for (const row of lemmaParts) {
    const part = parts.get(row.textTrackId) ?? { partIndex: row.partIndex, lemmas: [] }
    part.lemmas.push(row.lemma)
    parts.set(row.textTrackId, part)
  }

  const state = newOccurrenceScanState()
  const ordered = [...parts.entries()].sort((a, b) => a[1].partIndex - b[1].partIndex)
  for (const [textTrackId, part] of ordered) {
    const pending = part.lemmas.filter((lemma) => isStillWanted(state, lemma))
    if (pending.length === 0) continue
    const lemmasByToken = await guardedTokensForPart(
      { textTrackId, targetLanguage: params.targetLanguage, lemmas: pending },
      deps
    )
    const wanted = new Set(pending)
    let cursor = part.partIndex === params.position.partIndex ? params.position.afterSegmentIndex : null
    for (;;) {
      const segments = await deps.textSegmentsRepository.listPageAfterIndex({
        textTrackId,
        afterIndex: cursor,
        limit: SEGMENT_PAGE_SIZE,
      })
      if (segments.length === 0) break
      scanFirstOccurrences(segments, lemmasByToken, wanted, params.targetLanguage, state)
      if (pending.every((lemma) => !isStillWanted(state, lemma)) || segments.length < SEGMENT_PAGE_SIZE) break
      cursor = segments[segments.length - 1].index
    }
  }
  return finishOccurrenceScan(state)
}

export type PrelearnItem = {
  lemma: string
  headword: string
  aheadCount: number
  segmentId: string
  surface: string
  context: string
}

export type PrelearnList = { items: PrelearnItem[]; savedCount: number }

export type PrelearnResult<T> = { ok: true; value: T } | { ok: false; reason: 'not-found' }

export const listPrelearnCandidates = async (
  params: { contentSourceId: string; userId: string; horizon: PrelearnHorizon },
  deps: BookPrelearnDependencies
): Promise<PrelearnResult<PrelearnList>> => {
  const source = await deps.booksRepository.findOwnedBook(params.contentSourceId, params.userId)
  if (!source || !isBookReady(source)) return { ok: false, reason: 'not-found' }
  if (!KAIKKI_LANGUAGES.has(source.language)) return { ok: true, value: { items: [], savedCount: 0 } }

  const { candidates, savedCount } = await deps.bookPrelearnRepository.listCandidates({
    userId: params.userId,
    contentSourceId: source.id,
    targetLanguage: source.language,
    horizon: params.horizon,
    limit: PRELEARN_LIST_LIMIT + CANDIDATE_OVERFETCH,
  })
  if (candidates.length === 0) return { ok: true, value: { items: [], savedCount } }

  // The same "furthest-reached part" position the candidate SQL uses.
  const parts = await deps.booksRepository.listPartsForUser(source.id, params.userId)
  const current = parts
    .filter((part) => part.furthest_read_segment_index !== null)
    .sort((a, b) => b.book_part_index - a.book_part_index)[0]
  const lemmas = candidates.map((candidate) => candidate.lemma)
  const [occurrences, headwords] = await Promise.all([
    findOccurrencesAhead(
      {
        contentSourceId: source.id,
        targetLanguage: source.language,
        lemmas,
        position: current
          ? { partIndex: current.book_part_index, afterSegmentIndex: current.furthest_read_segment_index }
          : { partIndex: 0, afterSegmentIndex: null },
      },
      deps
    ),
    deps.wiktionaryMatchRepository.resolveDisplayHeadwords({ targetLanguage: source.language, foldedLemmas: lemmas }),
  ])

  const items: PrelearnItem[] = []
  for (const candidate of candidates) {
    const occurrence = occurrences.get(candidate.lemma)
    if (!occurrence) continue
    items.push({
      lemma: candidate.lemma,
      headword: headwords.get(candidate.lemma) ?? candidate.lemma,
      aheadCount: Math.max(1, Math.round(candidate.ahead)),
      ...occurrence,
    })
    if (items.length === PRELEARN_LIST_LIMIT) break
  }
  return { ok: true, value: { items, savedCount } }
}

export type PrelearnGlossRequest = { lemma: string; headword: string; segmentId: string; context: string }

// Glosses of each word in its listed sentence: cached rows first, one batched
// Haiku call for the rest. Only lemmas and segments of this book are accepted,
// so the endpoint can't be used as a general translator. A failed generation
// just leaves those rows without a gloss.
export const getPrelearnGlosses = async (
  params: { contentSourceId: string; userId: string; items: readonly PrelearnGlossRequest[] },
  deps: BookPrelearnDependencies
): Promise<PrelearnResult<Array<{ lemma: string; gloss: string }>>> => {
  const source = await deps.booksRepository.findOwnedBook(params.contentSourceId, params.userId)
  if (!source || !isBookReady(source)) return { ok: false, reason: 'not-found' }

  const language = await getLanguageMode({
    userId: params.userId,
    targetLanguage: source.language,
    usersRepository: deps.usersRepository,
    targetLanguagePrefsRepository: deps.userTargetLanguagePrefsRepository,
  })
  if (!language.nativeLanguage) return { ok: true, value: [] }
  const glossLanguage = language.hideTranslationFields ? source.language : language.nativeLanguage

  const [bookLemmas, bookSegments] = await Promise.all([
    deps.bookPrelearnRepository.filterBookLemmas({
      contentSourceId: source.id,
      lemmas: params.items.map((item) => item.lemma),
    }),
    deps.bookPrelearnRepository.filterBookSegments({
      contentSourceId: source.id,
      segmentIds: params.items.map((item) => item.segmentId),
    }),
  ])
  const lemmaSet = new Set(bookLemmas)
  const segmentSet = new Set(bookSegments)
  const items = params.items.filter((item) => lemmaSet.has(item.lemma) && segmentSet.has(item.segmentId))

  const cached = await deps.bookPrelearnRepository.listGlosses({
    contentSourceId: source.id,
    glossLanguage,
    lemmas: items.map((item) => item.lemma),
  })
  const cacheKey = (lemma: string, segmentId: string) => `${lemma}\u0000${segmentId}`
  const cachedByKey = new Map(cached.map((row) => [cacheKey(row.lemma, row.textSegmentId), row.gloss]))
  const missing = items.filter((item) => !cachedByKey.has(cacheKey(item.lemma, item.segmentId)))

  const generated: DbPrelearnGloss[] = []
  if (missing.length > 0) {
    try {
      const glosses = await deps.anthropicPasses.prelearnGlossPass({
        targetLanguage: source.language,
        nativeLanguage: language.nativeLanguage,
        hideTranslationFields: language.hideTranslationFields,
        items: missing.map((item) => ({ headword: item.headword, context: item.context })),
      })
      missing.forEach((item, i) => {
        const gloss = glosses[i]
        if (gloss) generated.push({ lemma: item.lemma, textSegmentId: item.segmentId, gloss })
      })
      await deps.bookPrelearnRepository.insertGlosses({ contentSourceId: source.id, glossLanguage, glosses: generated })
    } catch (e) {
      logCustomErrorMessageAndError(`getPrelearnGlosses: prelearnGlossPass failed for userId=${params.userId}`, e)
    }
  }
  for (const row of generated) cachedByKey.set(cacheKey(row.lemma, row.textSegmentId), row.gloss)

  const value: Array<{ lemma: string; gloss: string }> = []
  for (const item of items) {
    const gloss = cachedByKey.get(cacheKey(item.lemma, item.segmentId))
    if (gloss) value.push({ lemma: item.lemma, gloss })
  }
  return { ok: true, value }
}

// The list's "Known": one known-lemma mark with book provenance. Undo is the
// gloss sheet's plain un-mark (the list only offers lemmas not yet known, so
// the row this inserts is the only one for the lemma).
export const markPrelearnKnown = async (
  params: { contentSourceId: string; userId: string; lemma: string },
  deps: BookPrelearnDependencies
): Promise<PrelearnResult<{ markedCount: number }>> => {
  const source = await deps.booksRepository.findOwnedBook(params.contentSourceId, params.userId)
  if (!source || !isBookReady(source)) return { ok: false, reason: 'not-found' }
  const [lemma] = await deps.bookPrelearnRepository.filterBookLemmas({
    contentSourceId: source.id,
    lemmas: [params.lemma],
  })
  if (!lemma) return { ok: false, reason: 'not-found' }
  const markedCount = await deps.knownLemmasRepository.bulkMarkKnown({
    userId: params.userId,
    targetLanguage: source.language,
    lemmas: [lemma],
    source: 'book_prelearn',
    sourceId: source.id,
    sweepBatchId: null,
  })
  return { ok: true, value: { markedCount } }
}

// The list's "Learn": an ordinary adhoc save, recognition only, with the
// upcoming sentence as context. Book-stream membership is by occurrences, not
// provenance, so a pinned book prioritizes the card like any other save.
// The basic-data pass lemmatizes the headword itself; when its headword no
// longer covers the book lemma the card silently misses the book, so the
// mismatch is logged to learn whether that happens in practice.
export const learnPrelearnWord = async (
  params: { contentSourceId: string; userId: string; lemma: string; headword: string; context: string },
  deps: BookPrelearnDependencies
): Promise<PrelearnResult<{ cardId: string }>> => {
  const source = await deps.booksRepository.findOwnedBook(params.contentSourceId, params.userId)
  if (!source || !isBookReady(source)) return { ok: false, reason: 'not-found' }
  const [lemma] = await deps.bookPrelearnRepository.filterBookLemmas({
    contentSourceId: source.id,
    lemmas: [params.lemma],
  })
  if (!lemma) return { ok: false, reason: 'not-found' }

  const result = await createAdhocCard({
    userId: params.userId,
    targetLanguage: source.language,
    headword: params.headword,
    context: params.context,
    studyIntent: { skills: ['meaning_recognition'], formScope: 'lemma' },
    deps: deps.createAdhocCardDependencies,
  })

  const covers = await deps.bookPrelearnRepository.lookupCoversLemma({ userLookupId: result.userLookupId, lemma })
  if (!covers) {
    logMessage(
      `learnPrelearnWord: card headword drifted from book lemma "${lemma}" (sent "${params.headword}", ` +
        `userLookupId=${result.userLookupId}, contentSourceId=${source.id})`
    )
  }
  return { ok: true, value: { cardId: result.cardId } }
}

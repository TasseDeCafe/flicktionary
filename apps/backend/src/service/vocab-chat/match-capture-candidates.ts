import type { AnthropicPassesInterface } from '../../transport/third-party/anthropic/anthropic-passes'
import type {
  KeptSenseWithCard,
  UserLookupsRepositoryInterface,
} from '../../transport/database/user-lookups/user-lookups-repository'
import type {
  CaptureDemandRepositoryInterface,
  CaptureTermStatus,
} from '../../transport/database/capture-demand/capture-demand-repository'
import { logError } from '../../transport/error-monitoring/error-monitoring'
import { normalizeHeadword } from './run-vocab-chat'

export type TestedSkill = 'meaning_recognition' | 'meaning_production'

export type CaptureMatch = {
  testedSkill: TestedSkill
  // The saved term with this candidate's meaning, else null (the row offers Add).
  existingCard: { userLookupId: string; cardId: string; sessionId: string } | null
  // When there's no match: how the learner saved the headword's other
  // meanings, so the row can say why it still offers Add.
  otherSenses: string[]
  // The matched term's cards and today's capture demand.
  status: CaptureTermStatus | null
}

export type CaptureContext =
  { kind: 'search'; text: string; inputLanguage: string | null } | { kind: 'chat'; userMessage: string }

// senseMatchPass answers keyed by everything they depend on (the candidate,
// the query meaning, and the saved senses with their ids), so a cached answer
// can't outlive a vocabulary change. Spares the Haiku call on every reopen of
// a chat thread or a search.
export type SenseMatchCache = {
  get: (key: string) => string | null | undefined
  set: (key: string, matchedId: string | null) => void
}

const senseLabel = (row: KeptSenseWithCard): string => row.sense || row.translation || row.definition || ''

const foldForMatch = (text: string): string => normalizeHeadword(text).toLowerCase()

// Which card a candidate tests. A search tests one card for all: a
// native-language query means the learner was looking for the word
// (production), a target-language one that they met it (recognition). A chat
// proposal tests recognition when the learner's own message contains the
// headword ("what does ждать mean?"), production otherwise ("how do I say
// 'to wait'?", topic lists).
export const testedSkillFor = (context: CaptureContext, targetLanguage: string, headword: string): TestedSkill => {
  if (context.kind === 'search') {
    return context.inputLanguage !== targetLanguage ? 'meaning_production' : 'meaning_recognition'
  }
  return foldForMatch(context.userMessage).includes(foldForMatch(headword))
    ? 'meaning_recognition'
    : 'meaning_production'
}

// Whether each candidate is already in the learner's vocabulary, by meaning
// rather than by headword: есть = "there is" saved doesn't make есть = "to
// eat" a duplicate. senseMatchPass (biased toward "new") decides among the
// headword's kept senses. A wrong "new" is harmless, since Add runs the save
// path's own sense dedup; a pass error is treated as "new" for the same
// reason. A candidate already known to be a term (an added chat item) skips
// the match while that term is kept. Matched terms carry their practice
// status, read fresh. Results are in candidate order.
export const matchCaptureCandidates = async (
  params: {
    userId: string
    targetLanguage: string
    context: CaptureContext
    candidates: Array<{ headword: string; note: string; example: string; userLookupId?: string }>
  },
  deps: {
    anthropicPasses: Pick<AnthropicPassesInterface, 'senseMatchPass'>
    userLookupsRepository: Pick<UserLookupsRepositoryInterface, 'listKeptSensesByHeadwords' | 'listKeptTermCards'>
    captureDemandRepository: Pick<CaptureDemandRepositoryInterface, 'listCaptureStatus'>
    senseMatchCache?: SenseMatchCache
  }
): Promise<CaptureMatch[]> => {
  const headwords = params.candidates.map((c) => normalizeHeadword(c.headword))
  const [saved, knownCards] = await Promise.all([
    deps.userLookupsRepository.listKeptSensesByHeadwords({
      userId: params.userId,
      targetLanguage: params.targetLanguage,
      headwords,
    }),
    deps.userLookupsRepository.listKeptTermCards({
      userId: params.userId,
      userLookupIds: params.candidates.flatMap((c) => (c.userLookupId ? [c.userLookupId] : [])),
    }),
  ])
  // A native-language search names the meaning the learner was after, so the
  // pass gets it as the candidate's translation (the save path's meaningHint
  // does the same).
  const queryMeaning =
    params.context.kind === 'search' && params.context.inputLanguage !== params.targetLanguage
      ? params.context.text
      : null

  const matchSense = async (
    headword: string,
    candidate: { note: string; example: string },
    rows: KeptSenseWithCard[]
  ): Promise<string | null> => {
    const key = JSON.stringify([
      params.targetLanguage,
      headword,
      candidate.note,
      candidate.example,
      queryMeaning,
      rows.map((row) => [row.id, row.sense, row.definition, row.translation]),
    ])
    const cached = deps.senseMatchCache?.get(key)
    if (cached !== undefined) return cached
    try {
      const matchedId = await deps.anthropicPasses.senseMatchPass({
        targetLanguage: params.targetLanguage,
        headword,
        candidate: {
          sense: candidate.note,
          definition: null,
          translation: queryMeaning,
          sentence: candidate.example || null,
        },
        existing: rows.map((row) => ({
          userLookupId: row.id,
          sense: row.sense,
          definition: row.definition,
          translation: row.translation,
        })),
      })
      deps.senseMatchCache?.set(key, matchedId)
      return matchedId
    } catch (error) {
      logError({ message: 'senseMatchPass failed; treating the candidate as new', params: { headword }, error })
      return null
    }
  }

  const matches = await Promise.all(
    params.candidates.map(async (candidate, index): Promise<CaptureMatch> => {
      const headword = headwords[index]!
      const testedSkill = testedSkillFor(params.context, params.targetLanguage, headword)
      const noMatch: CaptureMatch = { testedSkill, existingCard: null, otherSenses: [], status: null }
      // Its saved headword may differ from the proposal's (the save picks the
      // citation form), so a known term is read by id.
      const knownCard = candidate.userLookupId ? knownCards.get(candidate.userLookupId) : undefined
      if (candidate.userLookupId && knownCard) {
        return { ...noMatch, existingCard: { userLookupId: candidate.userLookupId, ...knownCard } }
      }

      const rows = saved.get(headword.toLowerCase()) ?? []
      if (rows.length === 0) return noMatch
      const matchedId = await matchSense(headword, candidate, rows)
      const matched = rows.find((row) => row.id === matchedId)
      if (matched) {
        return {
          ...noMatch,
          existingCard: { userLookupId: matched.id, cardId: matched.cardId, sessionId: matched.sessionId },
        }
      }
      return { ...noMatch, otherSenses: [...new Set(rows.map(senseLabel).filter(Boolean))] }
    })
  )

  const statuses = await deps.captureDemandRepository.listCaptureStatus({
    userId: params.userId,
    userLookupIds: [...new Set(matches.flatMap((m) => (m.existingCard ? [m.existingCard.userLookupId] : [])))],
  })
  return matches.map((m) => (m.existingCard ? { ...m, status: statuses.get(m.existingCard.userLookupId) ?? null } : m))
}

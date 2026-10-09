import type { AnthropicPassesInterface } from '../../transport/third-party/anthropic/anthropic-passes'
import type {
  KeptSenseWithCard,
  UserLookupsRepositoryInterface,
} from '../../transport/database/user-lookups/user-lookups-repository'
import { logError } from '../../transport/error-monitoring/error-monitoring'
import { normalizeHeadword } from './run-vocab-chat'

export type CaptureMatch = {
  // The saved term with this candidate's meaning, else null (the row offers Add).
  existingCard: { userLookupId: string; cardId: string; sessionId: string } | null
  // When there's no match: how the learner saved the headword's other
  // meanings, so the row can say why it still offers Add.
  otherSenses: string[]
}

const NO_MATCH: CaptureMatch = { existingCard: null, otherSenses: [] }

const senseLabel = (row: KeptSenseWithCard): string => row.sense || row.translation || row.definition || ''

// Whether each "Translate & add" candidate is already in the learner's
// vocabulary, by meaning rather than by headword: есть = "there is" saved
// doesn't make есть = "to eat" a duplicate. senseMatchPass (biased toward
// "new") decides among the headword's kept senses. A wrong "new" is harmless,
// since Add runs the save path's own sense dedup; a pass error is treated as
// "new" for the same reason. Results are in candidate order.
export const matchCaptureCandidates = async (
  params: {
    userId: string
    targetLanguage: string
    // The search text. A native-language query names the meaning the learner
    // was after, so the pass gets it as the candidate's translation (the save
    // path's meaningHint does the same).
    query: string
    inputLanguage: string | null
    candidates: Array<{ headword: string; note: string; example: string }>
  },
  deps: {
    anthropicPasses: Pick<AnthropicPassesInterface, 'senseMatchPass'>
    userLookupsRepository: Pick<UserLookupsRepositoryInterface, 'listKeptSensesByHeadwords'>
  }
): Promise<CaptureMatch[]> => {
  const headwords = params.candidates.map((c) => normalizeHeadword(c.headword))
  const saved = await deps.userLookupsRepository.listKeptSensesByHeadwords({
    userId: params.userId,
    targetLanguage: params.targetLanguage,
    headwords,
  })
  const queryMeaning = params.inputLanguage !== params.targetLanguage ? params.query : null

  return Promise.all(
    params.candidates.map(async (candidate, index): Promise<CaptureMatch> => {
      const headword = headwords[index]!
      const rows = saved.get(headword.toLowerCase()) ?? []
      if (rows.length === 0) return NO_MATCH

      let matchedId: string | null = null
      try {
        matchedId = await deps.anthropicPasses.senseMatchPass({
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
      } catch (error) {
        logError({ message: 'senseMatchPass failed; treating the candidate as new', params: { headword }, error })
      }

      const matched = rows.find((row) => row.id === matchedId)
      if (matched) {
        return {
          existingCard: { userLookupId: matched.id, cardId: matched.cardId, sessionId: matched.sessionId },
          otherSenses: [],
        }
      }
      return { existingCard: null, otherSenses: [...new Set(rows.map(senseLabel).filter(Boolean))] }
    })
  )
}

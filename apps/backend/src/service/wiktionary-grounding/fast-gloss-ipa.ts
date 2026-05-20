import type { GrammarIpaBag } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import type {
  DbWiktionaryEntry,
  WiktionaryEntriesRepositoryInterface,
} from '../../transport/database/wiktionary-entries/wiktionary-entries-repository'
import { KAIKKI_ENABLED_LANGUAGES } from './config'
import { extractIpaBag } from './extract'

const FAST_GLOSS_POS_TO_KAIKKI: Record<string, string> = {
  n: 'noun',
  noun: 'noun',
  v: 'verb',
  verb: 'verb',
  adj: 'adj',
  adjective: 'adj',
  adv: 'adv',
  adverb: 'adv',
  prep: 'prep',
  preposition: 'prep',
  pron: 'pron',
  pronoun: 'pron',
  particle: 'particle',
  conj: 'conj',
  conjunction: 'conj',
  num: 'num',
  numeral: 'num',
}

const normalizeFastGlossPos = (pos: string | null): string | null => {
  if (!pos) return null
  const normalized = pos
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_ -]/gu, '')
    .replace(/\s+/g, ' ')
  return FAST_GLOSS_POS_TO_KAIKKI[normalized] ?? null
}

const directLookupHeadwords = (params: { targetLanguage: string; headword: string; pos: string }): string[] => {
  const out = [params.headword]
  if (params.targetLanguage === 'en' && params.pos === 'verb') {
    const bareInfinitive = params.headword.replace(/^to\s+/i, '').trim()
    if (bareInfinitive && bareInfinitive !== params.headword) out.push(bareInfinitive)
  }
  return out
}

const uniqueById = (entries: DbWiktionaryEntry[]): DbWiktionaryEntry[] => {
  const seen = new Set<number>()
  const out: DbWiktionaryEntry[] = []
  for (const entry of entries) {
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    out.push(entry)
  }
  return out
}

const findPreciseEntry = async (params: {
  targetLanguage: string
  headword: string
  pos: string
  wiktionaryEntriesRepository: WiktionaryEntriesRepositoryInterface
}): Promise<DbWiktionaryEntry | null> => {
  const { targetLanguage, headword, pos, wiktionaryEntriesRepository } = params

  for (const directHeadword of directLookupHeadwords({ targetLanguage, headword, pos })) {
    const direct = await wiktionaryEntriesRepository.findRealLemmaByHeadwordAndPos({
      targetLanguage,
      headword: directHeadword,
      pos,
    })
    if (direct) return direct
  }

  const formOfLemma = await wiktionaryEntriesRepository.findFormOfLemma({ targetLanguage, headword })
  if (formOfLemma) {
    const resolved = await wiktionaryEntriesRepository.findRealLemmaByHeadwordAndPos({
      targetLanguage,
      headword: formOfLemma,
      pos,
    })
    if (resolved) return resolved
  }

  return wiktionaryEntriesRepository.findRealLemmaByFormAndPos({ targetLanguage, form: headword, pos })
}

const findUnambiguousEntry = async (params: {
  targetLanguage: string
  headword: string
  wiktionaryEntriesRepository: WiktionaryEntriesRepositoryInterface
}): Promise<DbWiktionaryEntry | null> => {
  const { targetLanguage, headword, wiktionaryEntriesRepository } = params
  const direct = await wiktionaryEntriesRepository.listRealLemmasByHeadword({ targetLanguage, headword })
  if (direct.length > 0) {
    const unique = uniqueById(direct)
    return unique.length === 1 ? unique[0] : null
  }

  const formOfLemma = await wiktionaryEntriesRepository.findFormOfLemma({ targetLanguage, headword })
  if (formOfLemma) {
    const resolved = await wiktionaryEntriesRepository.listRealLemmasByHeadword({
      targetLanguage,
      headword: formOfLemma,
    })
    const unique = uniqueById(resolved)
    if (unique.length > 0) return unique.length === 1 ? unique[0] : null
  }

  const byForm = await wiktionaryEntriesRepository.listRealLemmasByForm({ targetLanguage, form: headword })
  const unique = uniqueById(byForm)
  return unique.length === 1 ? unique[0] : null
}

export const lookupFastGlossIpa = async (params: {
  targetLanguage: string
  selectionText: string
  pos: string | null
  wiktionaryEntriesRepository: WiktionaryEntriesRepositoryInterface
}): Promise<GrammarIpaBag | null> => {
  const { targetLanguage, selectionText, wiktionaryEntriesRepository } = params
  if (!KAIKKI_ENABLED_LANGUAGES.has(targetLanguage)) return null

  const headword = selectionText.trim()
  if (!headword) return null

  const kaikkiPos = normalizeFastGlossPos(params.pos)
  const entry = kaikkiPos
    ? await findPreciseEntry({ targetLanguage, headword, pos: kaikkiPos, wiktionaryEntriesRepository })
    : await findUnambiguousEntry({ targetLanguage, headword, wiktionaryEntriesRepository })
  if (!entry) return null

  const ipa = extractIpaBag(entry.data, targetLanguage)
  return ipa.ga || ipa.rp || ipa.untagged ? ipa : null
}

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
  intj: 'intj',
  interjection: 'intj',
  'transitive verb': 'verb',
  'intransitive verb': 'verb',
  'phrasal verb': 'verb',
  'modal verb': 'verb',
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

const lookupHeadwords = (params: { targetLanguage: string; headword: string }): string[] => {
  const out = [params.headword]
  const lower =
    params.targetLanguage === 'en'
      ? params.headword.toLocaleLowerCase('en-US')
      : params.headword.toLocaleLowerCase()
  if (lower && lower !== params.headword) out.push(lower)
  return out
}

const directLookupHeadwords = (params: { targetLanguage: string; headword: string; pos: string }): string[] => {
  const out = lookupHeadwords(params)
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

const hasIpa = (ipa: GrammarIpaBag): boolean => !!(ipa.ga || ipa.rp || ipa.untagged)

const ipaKey = (ipa: GrammarIpaBag): string => JSON.stringify([ipa.ga ?? null, ipa.rp ?? null, ipa.untagged ?? null])

const mergeIpaBags = (bags: GrammarIpaBag[]): GrammarIpaBag | null => {
  const out: GrammarIpaBag = {}
  for (const bag of bags) {
    if (!out.ga && bag.ga) out.ga = bag.ga
    if (!out.rp && bag.rp) out.rp = bag.rp
    if (!out.untagged && bag.untagged) out.untagged = bag.untagged
  }
  return hasIpa(out) ? out : null
}

const extractEntryIpa = (entry: DbWiktionaryEntry, targetLanguage: string): GrammarIpaBag | null => {
  const data = typeof entry.data.pos === 'string' ? entry.data : { ...entry.data, pos: entry.pos }
  const ipa = extractIpaBag(data, targetLanguage)
  return hasIpa(ipa) ? ipa : null
}

type SurfaceIpaLookupResult = { kind: 'found'; ipa: GrammarIpaBag } | { kind: 'ambiguous' } | { kind: 'none' }

const pickUnambiguousSurfaceIpa = (
  entries: DbWiktionaryEntry[],
  targetLanguage: string
): SurfaceIpaLookupResult => {
  const bags = uniqueById(entries).flatMap((entry) => {
    const ipa = extractEntryIpa(entry, targetLanguage)
    return ipa ? [ipa] : []
  })
  if (bags.length === 0) return { kind: 'none' }
  if (bags.length === 1) return { kind: 'found', ipa: bags[0] }

  const keys = new Set(bags.map(ipaKey))
  if (keys.size === 1) return { kind: 'found', ipa: bags[0] }
  return { kind: 'ambiguous' }
}

const lookupSurfacePronunciation = async (params: {
  targetLanguage: string
  headword: string
  pos: string | null
  wiktionaryEntriesRepository: WiktionaryEntriesRepositoryInterface
}): Promise<SurfaceIpaLookupResult> => {
  const { targetLanguage, headword, pos, wiktionaryEntriesRepository } = params

  for (const surfaceHeadword of lookupHeadwords({ targetLanguage, headword })) {
    if (pos) {
      const entries = uniqueById(
        await wiktionaryEntriesRepository.listPronunciationEntriesByHeadwordAndPos({
          targetLanguage,
          headword: surfaceHeadword,
          pos,
        })
      )
      const merged = mergeIpaBags(
        entries.flatMap((entry) => {
          const ipa = extractEntryIpa(entry, targetLanguage)
          return ipa ? [ipa] : []
        })
      )
      if (merged) return { kind: 'found', ipa: merged }

      if (targetLanguage !== 'en') {
        const relaxed = pickUnambiguousSurfaceIpa(
          await wiktionaryEntriesRepository.listPronunciationEntriesByHeadword({
            targetLanguage,
            headword: surfaceHeadword,
          }),
          targetLanguage
        )
        if (relaxed.kind !== 'none') return relaxed
      }
      continue
    }

    const picked = pickUnambiguousSurfaceIpa(
      await wiktionaryEntriesRepository.listPronunciationEntriesByHeadword({
        targetLanguage,
        headword: surfaceHeadword,
      }),
      targetLanguage
    )
    if (picked.kind !== 'none') return picked
  }

  return { kind: 'none' }
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
  for (const directHeadword of lookupHeadwords({ targetLanguage, headword })) {
    const direct = await wiktionaryEntriesRepository.listRealLemmasByHeadword({
      targetLanguage,
      headword: directHeadword,
    })
    if (direct.length > 0) {
      const unique = uniqueById(direct)
      return unique.length === 1 ? unique[0] : null
    }
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

const appearsToBeEnglishInflectedForm = async (params: {
  targetLanguage: string
  headword: string
  pos: string | null
  wiktionaryEntriesRepository: WiktionaryEntriesRepositoryInterface
}): Promise<boolean> => {
  const { targetLanguage, headword, pos, wiktionaryEntriesRepository } = params
  if (targetLanguage !== 'en') return false

  const normalizedHeadword = headword.toLocaleLowerCase('en-US')
  const formOfLemma = await wiktionaryEntriesRepository.findFormOfLemma({ targetLanguage, headword })
  if (formOfLemma && formOfLemma.toLocaleLowerCase('en-US') !== normalizedHeadword) return true

  const byForm = pos
    ? await wiktionaryEntriesRepository.findRealLemmaByFormAndPos({ targetLanguage, form: headword, pos })
    : uniqueById(await wiktionaryEntriesRepository.listRealLemmasByForm({ targetLanguage, form: headword }))[0]

  return !!byForm && byForm.headword.toLocaleLowerCase('en-US') !== normalizedHeadword
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
  const surface = await lookupSurfacePronunciation({
    targetLanguage,
    headword,
    pos: kaikkiPos,
    wiktionaryEntriesRepository,
  })
  if (surface.kind === 'found') return surface.ipa
  if (surface.kind === 'ambiguous') return null

  if (
    await appearsToBeEnglishInflectedForm({
      targetLanguage,
      headword,
      pos: kaikkiPos,
      wiktionaryEntriesRepository,
    })
  ) {
    return null
  }

  const entry = kaikkiPos
    ? await findPreciseEntry({ targetLanguage, headword, pos: kaikkiPos, wiktionaryEntriesRepository })
    : await findUnambiguousEntry({ targetLanguage, headword, wiktionaryEntriesRepository })
  if (!entry) return null

  return extractEntryIpa(entry, targetLanguage)
}

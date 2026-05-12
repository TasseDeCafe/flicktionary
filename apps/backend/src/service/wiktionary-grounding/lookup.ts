import {
  DbWiktionaryEntry,
  WiktionaryEntriesRepositoryInterface,
} from '../../transport/database/wiktionary-entries/wiktionary-entries-repository'
import { KAIKKI_ENABLED_LANGUAGES } from './config'

// Walks four progressively-broader paths to find the right wiktionary_entries
// row for a (language, headword, pos) triple. Returns null when nothing
// matches — caller treats that as "pure LLM, no grounding".
//
//   1. Real-lemma direct hit on (lang, headword, pos). For English verbs, also
//      try the headword without a leading "to " under the same POS.
//   2. Real-lemma POS-agnostic hit on (lang, headword) — pos mismatches happen
//      when LLM POS disagrees with kaikki POS; better to ground than not.
//   3. Form-of pseudo-entry direct hit. The LLM occasionally normalizes to a
//      form rather than a lemma; we follow the pseudo-entry's
//      `senses[0].form_of[0].word` (with stress) back to the underlying lemma.
//   4. wiktionary_forms fallback for "form looks like a known inflection of
//      some lemma" — same headword as a paradigm cell, find its lemma.
export const findEntry = async (params: {
  targetLanguage: string
  headword: string
  pos: string | null
  wiktionaryEntriesRepository: WiktionaryEntriesRepositoryInterface
}): Promise<DbWiktionaryEntry | null> => {
  const { targetLanguage, headword, pos, wiktionaryEntriesRepository } = params
  if (!KAIKKI_ENABLED_LANGUAGES.has(targetLanguage)) return null
  if (!headword) return null

  if (pos) {
    for (const directHeadword of directLookupHeadwords({ targetLanguage, headword, pos })) {
      const direct = await wiktionaryEntriesRepository.findRealLemmaByHeadwordAndPos({
        targetLanguage,
        headword: directHeadword,
        pos,
      })
      if (direct) return direct
    }
  }

  const posAgnostic = await wiktionaryEntriesRepository.findRealLemmaByHeadword({ targetLanguage, headword })
  if (posAgnostic) return posAgnostic

  const formOfLemma = await wiktionaryEntriesRepository.findFormOfLemma({ targetLanguage, headword })
  if (formOfLemma) {
    const resolved = await wiktionaryEntriesRepository.findRealLemmaByHeadword({
      targetLanguage,
      headword: formOfLemma,
    })
    if (resolved) return resolved
  }

  return wiktionaryEntriesRepository.findRealLemmaByForm({ targetLanguage, form: headword })
}

const directLookupHeadwords = (params: { targetLanguage: string; headword: string; pos: string }): string[] => {
  const out = [params.headword]
  if (params.targetLanguage === 'en' && params.pos === 'verb') {
    const bareInfinitive = params.headword.replace(/^to\s+/i, '').trim()
    if (bareInfinitive && bareInfinitive !== params.headword) out.push(bareInfinitive)
  }
  return out
}

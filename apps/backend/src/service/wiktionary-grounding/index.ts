import { WiktionaryEntriesRepositoryInterface } from '../../transport/database/wiktionary-entries/wiktionary-entries-repository'
import { extractGrammarPatch, type GrammarPatch } from './extract'
import { findEntry } from './lookup'
import { buildGrammarPatchFromKaikki } from './merge'

export type GroundingResult = {
  patch: Record<string, unknown>
  matchedHeadword: string
  matchedPos: string
}

// Look up `(targetLanguage, headword, pos)` in our wiktionary tables and
// return the patch we want shallow-merged into the user_lookups.grammar JSONB
// column. Returns null when:
//   - the language isn't in KAIKKI_LANGUAGES,
//   - no entry matched any of the four lookup paths, OR
//   - the entry yielded an empty patch (nothing useful to merge).
//
// Caller is responsible for stamping `grounded_at` when the result is
// non-null.
export const groundChunk = async (params: {
  targetLanguage: string
  headword: string
  // The grammar.pos value the LLM emitted, if any. Loosens to a POS-agnostic
  // search when missing or mismatching.
  pos: string | null
  wiktionaryEntriesRepository: WiktionaryEntriesRepositoryInterface
}): Promise<GroundingResult | null> => {
  const kaikkiPos = mapGrammarPosToKaikkiPos(params.pos)
  const entry = await findEntry({
    targetLanguage: params.targetLanguage,
    headword: params.headword,
    pos: kaikkiPos,
    wiktionaryEntriesRepository: params.wiktionaryEntriesRepository,
  })
  if (!entry) return null

  const grammarPatch: GrammarPatch = extractGrammarPatch(entry.data, params.targetLanguage)
  const patch = buildGrammarPatchFromKaikki(grammarPatch)
  if (Object.keys(patch).length === 0) return null

  return { patch, matchedHeadword: entry.headword, matchedPos: entry.pos }
}

// The LLM's grammar.pos enum doesn't exactly match kaikki's pos string. The
// table here is intentionally narrow — only the values we expect to appear in
// the LLM output. Anything else falls through as null (POS-agnostic lookup).
const mapGrammarPosToKaikkiPos = (pos: string | null): string | null => {
  if (!pos) return null
  switch (pos) {
    case 'noun':
      return 'noun'
    case 'verb':
      return 'verb'
    case 'adjective':
      return 'adj'
    case 'adverb':
      return 'adv'
    case 'preposition':
      return 'prep'
    case 'pronoun':
      return 'pron'
    case 'particle':
      return 'particle'
    case 'conjunction':
      return 'conj'
    case 'numeral':
      return 'num'
    default:
      return null
  }
}

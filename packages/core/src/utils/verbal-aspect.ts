import { getEffectiveGrammarFields } from '../constants/language-grammar'

// Dictionary-style abbreviations, shared by the grammar chips and the
// production-prompt aspect tag. Deliberately not localized: they read as
// lexicographic notation, like the POS chips.
export const renderAspectLabel = (aspect: string): string => {
  switch (aspect) {
    case 'impf':
      return 'impf.'
    case 'perf':
      return 'perf.'
    case 'biaspectual':
      return 'biasp.'
    default:
      return aspect
  }
}

// Short label ("impf.") to disambiguate a production prompt whose gloss alone
// is ambiguous between aspect twins (Russian "to see" → ви́деть/уви́деть).
// Gated like the grammar chips: the language must list `aspect` for the
// term's POS, so a stray aspect value the LLM left on a non-verb (or a
// language without grammatical aspect) never surfaces. Takes a loose record
// because core cannot import the `Grammar` type from api-client (dependency
// direction).
export const getAspectTag = (
  grammar: Record<string, unknown> | null | undefined,
  targetLanguage: string | undefined | null
): string | null => {
  if (!grammar) return null
  const aspect = grammar.aspect
  if (typeof aspect !== 'string' || aspect.trim().length === 0) return null
  const pos = typeof grammar.pos === 'string' ? grammar.pos : null
  if (!getEffectiveGrammarFields(targetLanguage, pos).includes('aspect')) return null
  return renderAspectLabel(aspect)
}

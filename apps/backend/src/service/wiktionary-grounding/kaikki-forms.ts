// Which entries of a kaikki record's `forms[]` become wiktionary_forms rows.
// The table means "this surface string is an inflection of this lemma"; every
// token→lemma resolver (checkpoint matching, sweeps, lemma profiles, word
// family, grounding) trusts that, so anything else in `forms[]` must stay out.

// kaikki packs internal metadata into the same array as real surface forms —
// not lookup-able strings.
const NON_FORM_TAGS = new Set(['romanization', 'class', 'inflection-template', 'table-tags'])

// Head-template cross-references to a DIFFERENT lexeme, recognizable by a tag
// set made of nothing but the relation: ru `забирать` lists its perfective
// partner `забрать` as ["perfective"] (conjugation-table cells always add
// infinitive/person/tense tags), and every de verb lists its auxiliary
// `haben`/`sein` as ["auxiliary"]. Loaded as forms, «забрать» in a text would
// count as an occurrence of «забирать», and «haben» of every saved verb.
const CROSS_REFERENCE_TAGS = new Set(['perfective', 'imperfective', 'auxiliary'])

export const isInflectionForm = (tags: unknown): boolean => {
  if (!Array.isArray(tags)) return true
  if (tags.some((t) => typeof t === 'string' && NON_FORM_TAGS.has(t))) return false
  if (tags.length > 0 && tags.every((t) => typeof t === 'string' && CROSS_REFERENCE_TAGS.has(t))) return false
  return true
}

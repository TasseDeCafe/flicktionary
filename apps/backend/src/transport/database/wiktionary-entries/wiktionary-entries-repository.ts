import { sql } from '../postgres-client'

// Reference data loaded from kaikki.org dumps. The full kaikki entry is kept
// untouched in `data`, so any field the extractor wants to read is reachable
// via JSONB navigation. See apps/backend/scripts/load-kaikki.ts for the
// loader and WIKTIONARY_GROUNDING.md for the overall design.
export type DbWiktionaryEntry = {
  id: number
  headword: string
  pos: string
  data: Record<string, unknown>
}

const stripStress = (s: string): string => s.replace(/́/g, '')

// Direct (lang, headword, pos) hit on real lemmas. Excludes form-of
// pseudo-entries (those carry no rich grammar — only a back-pointer to the
// underlying lemma).
const findRealLemmaByHeadwordAndPos = async (params: {
  targetLanguage: string
  headword: string
  pos: string
}): Promise<DbWiktionaryEntry | null> => {
  const result = (await sql`
    SELECT id, headword, pos, data
    FROM public.wiktionary_entries
    WHERE target_language = ${params.targetLanguage}
      AND headword = ${params.headword}
      AND pos = ${params.pos}
      AND data ? 'head_templates'
      AND NOT (data->'senses'->0 ? 'form_of')
    LIMIT 1
  `) as DbWiktionaryEntry[]
  return result[0] ?? null
}

const listRealLemmasByHeadword = async (params: {
  targetLanguage: string
  headword: string
}): Promise<DbWiktionaryEntry[]> => {
  return (await sql`
    SELECT id, headword, pos, data
    FROM public.wiktionary_entries
    WHERE target_language = ${params.targetLanguage}
      AND headword = ${params.headword}
      AND data ? 'head_templates'
      AND NOT (data->'senses'->0 ? 'form_of')
    ORDER BY id
  `) as DbWiktionaryEntry[]
}

// Same shape as findRealLemmaByHeadwordAndPos but POS-agnostic. Used as a
// fallback when the LLM's POS doesn't match kaikki's: better to ground with
// the wrong-POS row than not at all.
const findRealLemmaByHeadword = async (params: {
  targetLanguage: string
  headword: string
}): Promise<DbWiktionaryEntry | null> => {
  const result = await listRealLemmasByHeadword(params)
  return result[0] ?? null
}

// Form-of pseudo-entry resolution. The LLM occasionally normalizes a chunk
// to an inflected form (e.g. "обнаружил" instead of "обнаружить"). Kaikki
// stores those as pseudo-entries pointing at the lemma via
// `senses[0].form_of[0].word` (with stress). Returns the stress-stripped
// lemma string so the caller can re-look-up. Null when no pseudo-entry
// matches.
const findFormOfLemma = async (params: { targetLanguage: string; headword: string }): Promise<string | null> => {
  const result = (await sql`
    SELECT data->'senses'->0->'form_of'->0->>'word' AS lemma_with_stress
    FROM public.wiktionary_entries
    WHERE target_language = ${params.targetLanguage}
      AND headword = ${params.headword}
      AND data->'senses'->0 ? 'form_of'
    LIMIT 1
  `) as Array<{ lemma_with_stress: string | null }>
  const stressed = result[0]?.lemma_with_stress
  return stressed ? stripStress(stressed) : null
}

// Last-resort fallback: the headword matches a paradigm cell of some lemma
// (e.g. user's headword is "обнаружил", which is the past-masculine cell of
// "обнаружить"). Joins forms → entries to return the underlying real lemma.
const findRealLemmaByForm = async (params: {
  targetLanguage: string
  form: string
}): Promise<DbWiktionaryEntry | null> => {
  const result = (await sql`
    SELECT e.id, e.headword, e.pos, e.data
    FROM public.wiktionary_forms f
    JOIN public.wiktionary_entries e ON e.id = f.entry_id
    WHERE f.target_language = ${params.targetLanguage}
      AND f.form = ${params.form}
      AND e.data ? 'head_templates'
      AND NOT (e.data->'senses'->0 ? 'form_of')
    LIMIT 1
  `) as DbWiktionaryEntry[]
  return result[0] ?? null
}

const findRealLemmaByFormAndPos = async (params: {
  targetLanguage: string
  form: string
  pos: string
}): Promise<DbWiktionaryEntry | null> => {
  const result = (await sql`
    SELECT e.id, e.headword, e.pos, e.data
    FROM public.wiktionary_forms f
    JOIN public.wiktionary_entries e ON e.id = f.entry_id
    WHERE f.target_language = ${params.targetLanguage}
      AND f.form = ${params.form}
      AND e.pos = ${params.pos}
      AND e.data ? 'head_templates'
      AND NOT (e.data->'senses'->0 ? 'form_of')
    LIMIT 1
  `) as DbWiktionaryEntry[]
  return result[0] ?? null
}

const listRealLemmasByForm = async (params: { targetLanguage: string; form: string }): Promise<DbWiktionaryEntry[]> => {
  return (await sql`
    SELECT DISTINCT e.id, e.headword, e.pos, e.data
    FROM public.wiktionary_forms f
    JOIN public.wiktionary_entries e ON e.id = f.entry_id
    WHERE f.target_language = ${params.targetLanguage}
      AND f.form = ${params.form}
      AND e.data ? 'head_templates'
      AND NOT (e.data->'senses'->0 ? 'form_of')
    ORDER BY e.id
  `) as DbWiktionaryEntry[]
}

export interface WiktionaryEntriesRepositoryInterface {
  findRealLemmaByHeadwordAndPos: (params: {
    targetLanguage: string
    headword: string
    pos: string
  }) => Promise<DbWiktionaryEntry | null>
  listRealLemmasByHeadword: (params: { targetLanguage: string; headword: string }) => Promise<DbWiktionaryEntry[]>
  findRealLemmaByHeadword: (params: { targetLanguage: string; headword: string }) => Promise<DbWiktionaryEntry | null>
  findFormOfLemma: (params: { targetLanguage: string; headword: string }) => Promise<string | null>
  findRealLemmaByForm: (params: { targetLanguage: string; form: string }) => Promise<DbWiktionaryEntry | null>
  findRealLemmaByFormAndPos: (params: {
    targetLanguage: string
    form: string
    pos: string
  }) => Promise<DbWiktionaryEntry | null>
  listRealLemmasByForm: (params: { targetLanguage: string; form: string }) => Promise<DbWiktionaryEntry[]>
}

export const WiktionaryEntriesRepository = (): WiktionaryEntriesRepositoryInterface => {
  return {
    findRealLemmaByHeadwordAndPos,
    listRealLemmasByHeadword,
    findRealLemmaByHeadword,
    findFormOfLemma,
    findRealLemmaByForm,
    findRealLemmaByFormAndPos,
    listRealLemmasByForm,
  }
}

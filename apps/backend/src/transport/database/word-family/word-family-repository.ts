import type postgres from 'postgres'
import { beginTx, sql } from '../postgres-client'
import type { WordFamilyEntryData } from '../../../service/word-family/parse-word-family'

// Gloss-time reads for the reader's word-family line
// (docs/proposals/word-family-hints.md): the tapped word's kaikki entries,
// its precomputed family (wiktionary_word_family_edges, built offline by
// scripts/build-word-family.ts), and which family members the user already
// has. All lemma strings are checkpoint_fold-folded.

export type WordFamilyEntry = {
  headword: string
  folded: string
  pos: string
  // A real dictionary lemma (not a form-of / alt-of stub). Stubs still come
  // back so participles can say what they are a participle of.
  isRealLemma: boolean
  data: WordFamilyEntryData
}

export type WordFamilyTier = 'parent' | 'shared_root' | 'related'

export type WordFamilyCandidate = { lemma: string; tier: WordFamilyTier; depth: number }

export type WordFamilyVocabularyRow = { lemma: string; known: boolean; saved: boolean; rank: number | null }

type EntryRow = {
  headword: string
  folded: string
  pos: string
  is_real_lemma: boolean
  etymology_templates: unknown
  senses: unknown
}

const toEntry = (row: EntryRow): WordFamilyEntry => ({
  headword: row.headword,
  folded: row.folded,
  pos: row.pos,
  isRealLemma: row.is_real_lemma,
  data: { etymology_templates: row.etymology_templates, senses: row.senses },
})

// Every entry the folded token can belong to: a headword hit (stubs
// included), a paradigm cell of any entry, or a precomputed stub redirect.
const listEntriesForToken = async (params: {
  targetLanguage: string
  foldedToken: string
}): Promise<WordFamilyEntry[]> => {
  const { targetLanguage, foldedToken } = params
  const rows = (await sql`
    WITH hits AS (
      SELECT e.id
      FROM public.wiktionary_entries e
      WHERE e.target_language = ${targetLanguage}
        AND public.checkpoint_fold(e.headword, e.target_language) = ${foldedToken}
      UNION
      SELECT f.entry_id
      FROM public.wiktionary_forms f
      WHERE f.target_language = ${targetLanguage}
        AND public.checkpoint_fold(f.form, f.target_language) = ${foldedToken}
      UNION
      SELECT e.id
      FROM public.wiktionary_form_redirects r
      JOIN public.wiktionary_entries e
        ON e.target_language = r.target_language
       AND public.checkpoint_fold(e.headword, e.target_language) = public.checkpoint_fold(r.lemma, r.target_language)
      WHERE r.target_language = ${targetLanguage}
        AND r.folded_form = ${foldedToken}
    )
    SELECT
      e.headword,
      public.checkpoint_fold(e.headword, e.target_language) AS folded,
      e.pos,
      (
        e.data ? 'head_templates'
        AND NOT COALESCE(e.data->'senses'->0 ? 'form_of', FALSE)
        AND NOT COALESCE(e.data->'senses'->0 ? 'alt_of', FALSE)
      ) AS is_real_lemma,
      e.data->'etymology_templates' AS etymology_templates,
      (
        SELECT jsonb_agg(jsonb_build_object('form_of', s->'form_of', 'tags', s->'tags'))
        FROM jsonb_array_elements(e.data->'senses') s
        WHERE s ? 'form_of'
      ) AS senses
    FROM hits
    JOIN public.wiktionary_entries e ON e.id = hits.id
    ORDER BY e.id
  `) as EntryRow[]
  return rows.map(toEntry)
}

// Real-lemma entries of one folded headword — the form-of target whose
// breakdown a participle's structure line borrows.
const listLemmaEntries = async (params: { targetLanguage: string; folded: string }): Promise<WordFamilyEntry[]> => {
  const rows = (await sql`
    SELECT
      e.headword,
      public.checkpoint_fold(e.headword, e.target_language) AS folded,
      e.pos,
      TRUE AS is_real_lemma,
      e.data->'etymology_templates' AS etymology_templates,
      NULL::jsonb AS senses
    FROM public.wiktionary_entries e
    WHERE e.target_language = ${params.targetLanguage}
      AND public.checkpoint_fold(e.headword, e.target_language) = ${params.folded}
      AND e.data ? 'head_templates'
      AND NOT COALESCE(e.data->'senses'->0 ? 'form_of', FALSE)
      AND NOT COALESCE(e.data->'senses'->0 ? 'alt_of', FALSE)
    ORDER BY e.id
  `) as EntryRow[]
  return rows.map(toEntry)
}

// The word's family members by tier: its ancestors (parent), words sharing
// an ancestor with it or deriving from it (shared_root — the lemma itself is
// a depth-0 root), and stem-filtered related words in either direction.
// A member can surface in several tiers; callers keep the best one. The
// word-family insight adjusts the ancestors: `hiddenAncestors` (links a
// learner can't see) are dropped from every tier, before shared roots are
// looked up too, and
// `extraParents` (links kaikki lacks) join as depth-1 ancestors.
const listFamilyCandidates = async (params: {
  targetLanguage: string
  lemma: string
  lemmaPos: readonly string[]
  hiddenAncestors?: readonly string[]
  extraParents?: readonly string[]
}): Promise<WordFamilyCandidate[]> => {
  const { targetLanguage, lemma } = params
  const lemmaPos = sql.array([...params.lemmaPos])
  const hidden = sql.array([...(params.hiddenAncestors ?? [])])
  const extra = sql.array([...(params.extraParents ?? [])])
  const rows = (await sql`
    WITH own AS (
      SELECT relative, MIN(depth) AS depth
      FROM (
        SELECT relative, depth
        FROM public.wiktionary_word_family_edges
        WHERE target_language = ${targetLanguage}
          AND lemma = ${lemma}
          AND lemma_pos = ANY(${lemmaPos}::text[])
          AND kind = 'ancestor'
        UNION ALL
        SELECT unnest(${extra}::text[]), 1
      ) a
      WHERE relative <> ${lemma}
        AND relative <> ALL(${hidden}::text[])
      GROUP BY relative
    ),
    roots AS (
      SELECT relative, depth FROM own
      UNION ALL
      SELECT ${lemma}::text, 0
    )
    SELECT * FROM (
    SELECT relative AS lemma, 'parent' AS tier, depth::int AS depth FROM own
    UNION ALL
    SELECT e.lemma, 'shared_root', MIN(r.depth + e.depth)::int
    FROM roots r
    JOIN public.wiktionary_word_family_edges e
      ON e.target_language = ${targetLanguage}
     AND e.relative = r.relative
     AND e.kind = 'ancestor'
    WHERE e.lemma <> ${lemma}
    GROUP BY e.lemma
    UNION ALL
    SELECT relative, 'related', 1
    FROM public.wiktionary_word_family_edges
    WHERE target_language = ${targetLanguage}
      AND lemma = ${lemma}
      AND lemma_pos = ANY(${lemmaPos}::text[])
      AND kind = 'related'
    UNION ALL
    SELECT lemma, 'related', 1
    FROM public.wiktionary_word_family_edges
    WHERE target_language = ${targetLanguage}
      AND relative = ${lemma}
      AND kind = 'related'
    ) candidates
    -- A hidden ancestor can also come back as a related word or through
    -- another root; it never counts as family.
    WHERE lemma <> ALL(${hidden}::text[])
  `) as Array<{ lemma: string; tier: WordFamilyTier; depth: number }>
  return rows
}

// Which of `lemmas` the user has: marked known (known_lemmas) or saved as a
// live term (user_lookups through user_headword_lemma_keys), plus each
// lemma's frequency rank. Lemmas the user has neither way are absent.
const listUserVocabulary = async (params: {
  userId: string
  targetLanguage: string
  lemmas: readonly string[]
}): Promise<WordFamilyVocabularyRow[]> => {
  if (params.lemmas.length === 0) return []
  const lemmas = sql.array([...new Set(params.lemmas)])
  const rows = (await sql`
    WITH known AS (
      SELECT lemma
      FROM public.known_lemmas
      WHERE user_id = ${params.userId}
        AND target_language = ${params.targetLanguage}
        AND lemma = ANY(${lemmas}::text[])
    ),
    saved AS (
      SELECT DISTINCT k.lemma
      FROM public.user_lookups ul
      CROSS JOIN LATERAL unnest(public.user_headword_lemma_keys(ul.headword, ul.target_language)) AS k(lemma)
      WHERE ul.user_id = ${params.userId}
        AND ul.target_language = ${params.targetLanguage}
        AND ul.count > 0
        AND ul.deleted_at IS NULL
        AND k.lemma = ANY(${lemmas}::text[])
    ),
    owned AS (
      SELECT lemma FROM known
      UNION
      SELECT lemma FROM saved
    )
    SELECT
      o.lemma,
      EXISTS (SELECT 1 FROM known k WHERE k.lemma = o.lemma) AS known,
      EXISTS (SELECT 1 FROM saved s WHERE s.lemma = o.lemma) AS saved,
      r.rank
    FROM owned o
    LEFT JOIN public.lemma_ranks r ON r.target_language = ${params.targetLanguage} AND r.lemma = o.lemma
  `) as WordFamilyVocabularyRow[]
  return rows
}

// The lemma's kaikki ancestors (folded, nearest first) — what the insight
// pass judges for visibility.
const listAncestors = async (params: {
  targetLanguage: string
  lemma: string
  lemmaPos: readonly string[]
}): Promise<string[]> => {
  const rows = (await sql`
    SELECT relative, MIN(depth) AS depth
    FROM public.wiktionary_word_family_edges
    WHERE target_language = ${params.targetLanguage}
      AND lemma = ${params.lemma}
      AND lemma_pos = ANY(${sql.array([...params.lemmaPos])}::text[])
      AND kind = 'ancestor'
    GROUP BY relative
    ORDER BY MIN(depth), relative
  `) as Array<{ relative: string }>
  return rows.map((row) => row.relative)
}

export type WordFamilyInsightPart = { text: string; isAffix: boolean }

export type StoredWordFamilyInsight = {
  parts: WordFamilyInsightPart[]
  missingParents: string[]
  hiddenAncestors: string[]
  // Null until generated for the requested explanation language.
  explanation: { partMeanings: Array<string | null>; cognates: string[] } | null
}

type InsightKey = { targetLanguage: string; lemma: string; lemmaPos: string }

// The cached insight of one lemma (word_family_insights), with its
// explanation in `explanationLanguage` when that exists too.
const getInsight = async (
  params: InsightKey & { explanationLanguage: string }
): Promise<StoredWordFamilyInsight | null> => {
  const rows = (await sql`
    SELECT i.parts, i.missing_parents, i.hidden_ancestors, x.part_meanings, x.cognates
    FROM public.word_family_insights i
    LEFT JOIN public.word_family_insight_explanations x
      ON x.target_language = i.target_language
     AND x.lemma = i.lemma
     AND x.lemma_pos = i.lemma_pos
     AND x.explanation_language = ${params.explanationLanguage}
    WHERE i.target_language = ${params.targetLanguage}
      AND i.lemma = ${params.lemma}
      AND i.lemma_pos = ${params.lemmaPos}
  `) as Array<{
    parts: WordFamilyInsightPart[]
    missing_parents: string[]
    hidden_ancestors: string[]
    part_meanings: Array<string | null> | null
    cognates: string[] | null
  }>
  const row = rows[0]
  if (!row) return null
  return {
    parts: row.parts,
    missingParents: row.missing_parents,
    hiddenAncestors: row.hidden_ancestors,
    explanation: row.part_meanings ? { partMeanings: row.part_meanings, cognates: row.cognates ?? [] } : null,
  }
}

// First writer wins for both halves. Explanations pair with the breakdown by
// index, so one is only stored when its breakdown is the stored one: two
// readers tapping a new word at once both generate, and the loser learns
// (false) that its meanings don't fit the winner's parts. A conflicting
// insert waits for the concurrent one to commit, so the check sees the winner.
const saveInsight = async (
  params: InsightKey & {
    explanationLanguage: string
    parts: WordFamilyInsightPart[]
    missingParents: string[]
    hiddenAncestors: string[]
    partMeanings: Array<string | null>
    cognates: string[]
    model: string
  }
): Promise<boolean> => {
  return beginTx(async (tx) => {
    const parts = tx.json(params.parts as unknown as postgres.JSONValue)
    await tx`
      INSERT INTO public.word_family_insights
        (target_language, lemma, lemma_pos, parts, missing_parents, hidden_ancestors, model)
      VALUES (
        ${params.targetLanguage}, ${params.lemma}, ${params.lemmaPos}, ${parts},
        ${tx.array(params.missingParents)}::text[], ${tx.array(params.hiddenAncestors)}::text[], ${params.model}
      )
      ON CONFLICT DO NOTHING
    `
    const matching = await tx`
      SELECT 1
      FROM public.word_family_insights
      WHERE target_language = ${params.targetLanguage}
        AND lemma = ${params.lemma}
        AND lemma_pos = ${params.lemmaPos}
        AND parts = ${parts}::jsonb
    `
    if (matching.length === 0) return false
    await tx`
      INSERT INTO public.word_family_insight_explanations
        (target_language, lemma, lemma_pos, explanation_language, part_meanings, cognates, model)
      VALUES (
        ${params.targetLanguage}, ${params.lemma}, ${params.lemmaPos}, ${params.explanationLanguage},
        ${tx.json(params.partMeanings)}, ${tx.json(params.cognates)}, ${params.model}
      )
      ON CONFLICT DO NOTHING
    `
    return true
  })
}

export interface WordFamilyRepositoryInterface {
  listEntriesForToken: typeof listEntriesForToken
  listLemmaEntries: typeof listLemmaEntries
  listFamilyCandidates: typeof listFamilyCandidates
  listUserVocabulary: typeof listUserVocabulary
  listAncestors: typeof listAncestors
  getInsight: typeof getInsight
  saveInsight: typeof saveInsight
}

export const WordFamilyRepository = (): WordFamilyRepositoryInterface => {
  return {
    listEntriesForToken,
    listLemmaEntries,
    listFamilyCandidates,
    listUserVocabulary,
    listAncestors,
    getInsight,
    saveInsight,
  }
}

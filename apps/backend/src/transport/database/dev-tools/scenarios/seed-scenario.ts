import { createHash } from 'node:crypto'
import type postgres from 'postgres'
import { foldCheckpointToken } from '@flicktionary/core/utils/checkpoint-fold'
import { beginTx } from '../../postgres-client'
import type { ExerciseType } from '../../practice-exercises/practice-exercises-repository'
import type { PracticePool } from '../../study-facets/study-facets-repository'
import {
  buildWordFamily,
  explanationLanguageFor,
  loadWordFamilyEntries,
  pickFamilyEntries,
  type WordFamilyDependencies,
} from '../../../../service/word-family/word-family'
import { normalizeFastGlossPos } from '../../../../service/wiktionary-grounding/fast-gloss-ipa'
import type { BankSlot, CatalogInsight, CatalogTerm, FacetSeed, ScenarioSpec, ScenarioTerm } from './scenario-spec'

// Writes a ScenarioSpec into the database for one existing user, in three
// steps the CLI (scripts/dev--scenario.ts) and the integration test share:
//   prepareScenario — read-only: resolves the word-family insight keys the way
//     the app does and checks the dictionary prerequisites, so a missing
//     kaikki load fails BEFORE anything is wiped;
//   seedScenario — one transaction: wipe the user's content, write the spec;
//   verifyScenarioFamilies — reads every expected family line back through
//     the real word-family path (cached insights → no LLM call).
// No LLM calls anywhere. Every practice timestamp is NOW()-relative, so
// `pnpm db:advance-day` shifts a seeded account exactly like a real one.

// Marks the content sources a scenario created, so a reset deletes only those.
const SCENARIO_METADATA_KEY = 'devScenario'
const SCENARIO_MODEL = 'dev-scenario'

type InsightKey = { lemma: string; lemmaPos: string }

export type PreparedScenario = {
  spec: ScenarioSpec
  explanationLanguage: string
  // Per headword; null when the dictionary has no single lemma for it (the
  // app can't resolve one either, so nothing is ever generated for it).
  insightKeys: Map<string, InsightKey | null>
}

export class ScenarioPrerequisiteError extends Error {}

const resolveInsightKey = async (
  term: CatalogTerm,
  targetLanguage: string,
  deps: Pick<WordFamilyDependencies, 'wordFamilyRepository'>
): Promise<InsightKey | null> => {
  const lookup = await loadWordFamilyEntries({ targetLanguage, selectionText: term.headword }, deps)
  if (!lookup) return null
  const picked = pickFamilyEntries(
    lookup.entries,
    lookup.foldedToken,
    normalizeFastGlossPos(term.grammar.pos),
    targetLanguage
  )
  return picked ? { lemma: picked.folded, lemmaPos: picked.entries[0].pos } : null
}

export const prepareScenario = async (
  spec: ScenarioSpec,
  deps: Pick<WordFamilyDependencies, 'wordFamilyRepository'>,
  options: { requireDictionary: boolean }
): Promise<PreparedScenario> => {
  const insightKeys = new Map<string, InsightKey | null>()
  const missing: string[] = []
  for (const placed of spec.terms) {
    if (!placed.insight) continue
    const key = await resolveInsightKey(placed.term, spec.targetLanguage, deps)
    insightKeys.set(placed.term.headword, key)
    if (!key && placed.insight === 'curated') missing.push(placed.term.headword)
  }
  if (missing.length > 0 && options.requireDictionary) {
    throw new ScenarioPrerequisiteError(
      `No single ${spec.targetLanguage} dictionary lemma for: ${missing.join(', ')}. ` +
        `Load the kaikki data first (pnpm --filter @flicktionary/backend load-kaikki ${spec.targetLanguage}).`
    )
  }
  return {
    spec,
    // Explanations follow the gloss language; scenario users keep translations on.
    explanationLanguage: explanationLanguageFor(spec.targetLanguage, {
      nativeLanguage: spec.nativeLanguage,
      hideTranslationFields: false,
    }),
    insightKeys,
  }
}

// ---------------------------------------------------------------- reset

// Deletes everything practice-related the user owns. Sessions go first: their
// cards hold the RESTRICT reference to user_lookups. Lookups then cascade
// facets, rating events and exercises. The auth user and public.users row
// survive.
const resetUser = async (tx: postgres.Sql, userId: string): Promise<void> => {
  await tx`DELETE FROM public.study_sessions WHERE user_id = ${userId}`
  await tx`DELETE FROM public.import_batches WHERE user_id = ${userId}`
  await tx`DELETE FROM public.user_lookups WHERE user_id = ${userId}`
  await tx`DELETE FROM public.known_lemmas WHERE user_id = ${userId}`
  await tx`DELETE FROM public.lemma_lookups WHERE user_id = ${userId}`
  await tx`DELETE FROM public.book_pins WHERE user_id = ${userId}`
  await tx`DELETE FROM public.coverage_snapshots WHERE user_id = ${userId}`
  await tx`DELETE FROM public.user_target_language_prefs WHERE user_id = ${userId}`
  await tx`
    DELETE FROM public.content_sources
    WHERE created_by_user_id = ${userId} AND metadata ? ${SCENARIO_METADATA_KEY}
  `
}

// ---------------------------------------------------------------- exercises

const spanOf = (sentence: string, needle: string, what: string): { start: number; end: number } => {
  const start = sentence.indexOf(needle)
  if (start === -1) throw new Error(`dev scenario: ${what} "${needle}" not found in "${sentence}"`)
  return { start, end: start + needle.length }
}

// Stable answer position per term, so reseeding serves identical exercises.
const answerSlot = (seed: string): number => createHash('sha256').update(seed).digest()[0] % 4

export const exercisePayload = (term: CatalogTerm, type: ExerciseType): Record<string, unknown> => {
  if (type === 'use_in_sentence') return { term: term.headword, prompt: term.translation }
  const exercises = term.exercises
  if (!exercises) throw new Error(`dev scenario: ${term.headword} has no authored exercises for ${type}`)
  if (type === 'mc_comprehension') {
    const { sentence, term: surface, prompt, options, answerIndex } = exercises.comprehension
    const span = spanOf(sentence, surface, 'comprehension term')
    return { sentence, prompt, options, answerIndex, termStart: span.start, termEnd: span.end }
  }
  const { sentence, answer, distractors } = exercises.cloze
  const span = spanOf(sentence, answer, 'cloze answer')
  if (type === 'production_cloze') {
    return {
      sentence,
      blankStart: span.start,
      blankEnd: span.end,
      answer,
      acceptedForms: [answer],
      hint: term.translation,
    }
  }
  const answerIndex = answerSlot(term.headword)
  const options = [...distractors]
  options.splice(answerIndex, 0, answer)
  return { sentence, blankStart: span.start, blankEnd: span.end, answer, options, answerIndex }
}

const insertExercise = async (
  tx: postgres.Sql,
  params: { userId: string; userLookupId: string; targetLanguage: string; term: CatalogTerm; slot: BankSlot }
): Promise<void> => {
  const { slot } = params
  const payload = slot.status === 'failed' ? null : exercisePayload(params.term, slot.type)
  const ageSeconds = (slot.daysAgo ?? 0) * 86400 + 3600
  await tx`
    INSERT INTO public.practice_exercises
      (user_id, user_lookup_id, target_language, pool, exercise_type, status, payload, gate_eligible,
       generation_warning, created_at, ready_at, seen_at, used_at)
    VALUES (
      ${params.userId}, ${params.userLookupId}, ${params.targetLanguage}, ${slot.pool},
      ${slot.type}::public.exercise_type, ${slot.status}::public.exercise_status,
      ${payload === null ? null : tx.json(payload as postgres.JSONValue)},
      ${slot.type !== 'use_in_sentence'},
      ${slot.status === 'failed' ? 'dev scenario: seeded as terminally failed' : null},
      NOW() - make_interval(secs => ${ageSeconds}),
      ${slot.status === 'failed' ? null : tx`NOW() - make_interval(secs => ${ageSeconds})`},
      ${slot.status === 'used' ? tx`NOW() - make_interval(secs => ${(slot.daysAgo ?? 0) * 86400})` : null},
      ${slot.status === 'used' ? tx`NOW() - make_interval(secs => ${(slot.daysAgo ?? 0) * 86400})` : null}
    )
  `
}

// ---------------------------------------------------------------- facets

type Skill = 'meaning_recognition' | 'meaning_production'

const DAY_SECONDS = 86400

const insertFacet = async (
  tx: postgres.Sql,
  params: { userId: string; userLookupId: string; targetLanguage: string; skill: Skill; seed: FacetSeed }
): Promise<void> => {
  const { seed } = params
  if (seed.state === 'unseen') {
    await tx`
      INSERT INTO public.study_facets (user_lookup_id, user_id, target_language, skill, target_form)
      VALUES (${params.userLookupId}, ${params.userId}, ${params.targetLanguage}, ${params.skill}, '')
    `
    return
  }
  if (seed.state === 'warmup') {
    await tx`
      INSERT INTO public.study_facets
        (user_lookup_id, user_id, target_language, skill, target_form, introduced_at, leech_parked_at,
         leech_rehab_correct_days, leech_rehab_last_correct_on)
      VALUES (
        ${params.userLookupId}, ${params.userId}, ${params.targetLanguage}, ${params.skill}, '',
        NOW() - make_interval(secs => ${seed.introducedDaysAgo * DAY_SECONDS}),
        NOW() - make_interval(secs => ${seed.introducedDaysAgo * DAY_SECONDS}),
        ${seed.rehabCorrectDays},
        ${seed.lastCorrectDaysAgo === null ? null : tx`CURRENT_DATE - ${seed.lastCorrectDaysAgo}::int`}
      )
    `
    return
  }
  await tx`
    INSERT INTO public.study_facets
      (user_lookup_id, user_id, target_language, skill, target_form, srs_state, srs_due, srs_stability,
       srs_difficulty, srs_last_review, srs_reps, srs_lapses, introduced_at, disabled_at)
    VALUES (
      ${params.userLookupId}, ${params.userId}, ${params.targetLanguage}, ${params.skill}, '',
      ${seed.phase ?? 'review'}, NOW() + make_interval(secs => ${seed.dueInHours * 3600}), ${seed.stability},
      ${seed.difficulty}, NOW() - make_interval(secs => ${seed.lastReviewDaysAgo * DAY_SECONDS}),
      ${seed.reps}, ${seed.lapses},
      NOW() - make_interval(secs => ${seed.introducedDaysAgo * DAY_SECONDS}),
      ${seed.paused ? tx`NOW()` : null}
    )
  `
}

export type TrailEvent = {
  daysAgo: number
  rating: 'again' | 'good'
  wasIntroduction: boolean
  prevState: 'review' | 'relearning' | null
  prevReps: number
  prevLapses: number
  prevDaysAgo: number | null
}

// A plausible rating history for a review facet: `reps` events spread from
// the introduction to the last review, the `lapses` Again ratings late in the
// history (each followed by a recovering Good, so the facet ends in review).
// Only history-dependent surfaces read these (activity calendar, stats); undo
// only ever targets events the client got from rateTerm in its own session.
export const ratingTrail = (seed: Extract<FacetSeed, { state: 'review' }>): TrailEvent[] => {
  const count = Math.max(1, seed.reps)
  if (seed.lapses > Math.floor((count - 1) / 2)) {
    throw new Error(`dev scenario: ${seed.lapses} lapses need at least ${seed.lapses * 2 + 1} reps`)
  }
  const againAt = new Set(Array.from({ length: seed.lapses }, (_, i) => count - 2 - 2 * i))
  const span = seed.introducedDaysAgo - seed.lastReviewDaysAgo
  const events: TrailEvent[] = []
  let lapses = 0
  for (let index = 0; index < count; index++) {
    const daysAgo = count === 1 ? seed.lastReviewDaysAgo : seed.introducedDaysAgo - (span * index) / (count - 1)
    const previous = events[index - 1]
    events.push({
      daysAgo,
      rating: againAt.has(index) ? 'again' : 'good',
      wasIntroduction: index === 0,
      prevState: previous ? (previous.rating === 'again' ? 'relearning' : 'review') : null,
      prevReps: index,
      prevLapses: lapses,
      prevDaysAgo: previous?.daysAgo ?? null,
    })
    if (againAt.has(index)) lapses++
  }
  return events
}

const insertTrail = async (
  tx: postgres.Sql,
  params: {
    userId: string
    userLookupId: string
    targetLanguage: string
    term: CatalogTerm
    skill: Skill
    seed: Extract<FacetSeed, { state: 'review' }>
  }
): Promise<void> => {
  const pool: PracticePool = params.skill === 'meaning_production' ? 'production' : 'recognition'
  for (const event of ratingTrail(params.seed)) {
    await tx`
      INSERT INTO public.practice_rating_events
        (user_id, user_lookup_id, target_language, pool, rating, was_explicit, was_introduction,
         headword, sense, skill, target_form, prev_srs_state, prev_srs_due, prev_srs_stability,
         prev_srs_difficulty, prev_srs_last_review, prev_srs_reps, prev_srs_lapses, prev_srs_learning_steps,
         rated_at)
      VALUES (
        ${params.userId}, ${params.userLookupId}, ${params.targetLanguage}, ${pool}, ${event.rating}, true,
        ${event.wasIntroduction}, ${params.term.headword}, ${params.term.sense}, ${params.skill}, '',
        ${event.prevState}::public.srs_state,
        ${event.prevState ? tx`NOW() - make_interval(secs => ${event.daysAgo * DAY_SECONDS})` : null},
        ${event.prevState ? params.seed.stability : null},
        ${event.prevState ? params.seed.difficulty : null},
        ${event.prevDaysAgo === null ? null : tx`NOW() - make_interval(secs => ${event.prevDaysAgo * DAY_SECONDS})`},
        ${event.prevReps}, ${event.prevLapses}, 0,
        NOW() - make_interval(secs => ${event.daysAgo * DAY_SECONDS})
      )
    `
  }
}

// ---------------------------------------------------------------- insights

const writeInsight = async (
  tx: postgres.Sql,
  params: {
    targetLanguage: string
    explanationLanguage: string
    key: InsightKey
    mode: 'curated' | 'fill'
    insight: CatalogInsight | undefined
  }
): Promise<void> => {
  const { targetLanguage, explanationLanguage, key } = params
  const fold = (text: string) => foldCheckpointToken(text, targetLanguage)

  if (params.mode === 'fill') {
    const [existing] = (await tx`
      SELECT i.parts, x.lemma IS NOT NULL AS explained
      FROM public.word_family_insights i
      LEFT JOIN public.word_family_insight_explanations x
        ON x.target_language = i.target_language AND x.lemma = i.lemma AND x.lemma_pos = i.lemma_pos
       AND x.explanation_language = ${explanationLanguage}
      WHERE i.target_language = ${targetLanguage} AND i.lemma = ${key.lemma} AND i.lemma_pos = ${key.lemmaPos}
    `) as Array<{ parts: unknown[]; explained: boolean }>
    if (existing?.explained) return
    if (!existing) {
      await tx`
        INSERT INTO public.word_family_insights (target_language, lemma, lemma_pos, parts, model)
        VALUES (${targetLanguage}, ${key.lemma}, ${key.lemmaPos}, '[]'::jsonb, ${SCENARIO_MODEL})
      `
    }
    // Unexplained meanings, aligned with whatever breakdown is stored: the
    // line shows the parts bare, and the compose warmer sees it as cached.
    const meanings = (existing?.parts ?? []).map(() => null)
    await tx`
      INSERT INTO public.word_family_insight_explanations
        (target_language, lemma, lemma_pos, explanation_language, part_meanings, cognates, model)
      VALUES (${targetLanguage}, ${key.lemma}, ${key.lemmaPos}, ${explanationLanguage},
              ${tx.json(meanings)}, '[]'::jsonb, ${SCENARIO_MODEL})
    `
    return
  }

  const insight = params.insight
  if (!insight) throw new Error(`dev scenario: curated insight missing for ${key.lemma}`)
  if (insight.partMeanings.length !== insight.parts.length) {
    throw new Error(`dev scenario: ${key.lemma} part meanings don't align with its parts`)
  }
  // Replaces the shared cache entry outright: a preserved breakdown would pair
  // with different meanings, and its hidden ancestors could suppress anchors.
  await tx`
    INSERT INTO public.word_family_insights
      (target_language, lemma, lemma_pos, parts, missing_parents, hidden_ancestors, model)
    VALUES (
      ${targetLanguage}, ${key.lemma}, ${key.lemmaPos}, ${tx.json(insight.parts)},
      ${tx.array((insight.missingParents ?? []).map(fold))}::text[],
      ${tx.array((insight.hiddenAncestors ?? []).map(fold))}::text[],
      ${SCENARIO_MODEL}
    )
    ON CONFLICT (target_language, lemma, lemma_pos) DO UPDATE SET
      parts = EXCLUDED.parts,
      missing_parents = EXCLUDED.missing_parents,
      hidden_ancestors = EXCLUDED.hidden_ancestors,
      model = EXCLUDED.model,
      created_at = NOW()
  `
  // Every explanation language paired with the replaced breakdown is stale.
  await tx`
    DELETE FROM public.word_family_insight_explanations
    WHERE target_language = ${targetLanguage} AND lemma = ${key.lemma} AND lemma_pos = ${key.lemmaPos}
  `
  await tx`
    INSERT INTO public.word_family_insight_explanations
      (target_language, lemma, lemma_pos, explanation_language, part_meanings, cognates, model)
    VALUES (${targetLanguage}, ${key.lemma}, ${key.lemmaPos}, ${explanationLanguage},
            ${tx.json(insight.partMeanings)}, '[]'::jsonb, ${SCENARIO_MODEL})
  `
}

// ---------------------------------------------------------------- seed

const insertTerm = async (
  tx: postgres.Sql,
  params: {
    userId: string
    spec: ScenarioSpec
    placed: ScenarioTerm
    sessionId: string
    segmentId: string
  }
): Promise<string> => {
  const { userId, spec, placed } = params
  const { term } = placed
  const savedSeconds = placed.savedDaysAgo * DAY_SECONDS
  const [lookup] = (await tx`
    INSERT INTO public.user_lookups
      (user_id, target_language, headword, sense, translation, definition, target_example, native_example,
       grammar, zipf_estimate, count, created_at, last_encountered_at, last_demand_at)
    VALUES (
      ${userId}, ${spec.targetLanguage}, ${term.headword}, ${term.sense}, ${term.translation}, ${term.definition},
      ${term.targetExample}, ${term.nativeExample}, ${tx.json(term.grammar as postgres.JSONValue)}, ${term.zipf}, 1,
      NOW() - make_interval(secs => ${savedSeconds}),
      NOW() - make_interval(secs => ${savedSeconds}),
      NOW() - make_interval(secs => ${savedSeconds})
    )
    RETURNING id
  `) as [{ id: string }]

  // A kept card from the scenario's text source: Edit term, the focus view and
  // session vocabulary need a representative card, not just the lookup.
  if (!term.targetExample.includes(term.surface)) {
    throw new Error(`dev scenario: surface "${term.surface}" not in "${term.targetExample}"`)
  }
  const [card] = (await tx`
    INSERT INTO public.cards (study_session_id, segment_id, user_lookup_id, surface_form, status, created_at)
    VALUES (${params.sessionId}, ${params.segmentId}, ${lookup.id}, ${term.surface}, 'kept',
            NOW() - make_interval(secs => ${savedSeconds}))
    RETURNING id
  `) as [{ id: string }]
  await tx`UPDATE public.user_lookups SET first_card_id = ${card.id} WHERE id = ${lookup.id}`

  const facets: Array<[Skill, FacetSeed | undefined]> = [
    ['meaning_recognition', placed.recognition],
    ['meaning_production', placed.production],
  ]
  for (const [skill, seed] of facets) {
    if (!seed) continue
    const facetParams = { userId, userLookupId: lookup.id, targetLanguage: spec.targetLanguage, skill }
    await insertFacet(tx, { ...facetParams, seed })
    if (seed.state === 'review' && !seed.silent) await insertTrail(tx, { ...facetParams, term, seed })
  }

  for (const slot of placed.bank ?? []) {
    await insertExercise(tx, { userId, userLookupId: lookup.id, targetLanguage: spec.targetLanguage, term, slot })
  }
  return lookup.id
}

export const seedScenario = async (params: { userId: string; prepared: PreparedScenario }): Promise<void> => {
  const { userId, prepared } = params
  const { spec } = prepared
  await beginTx(async (tx) => {
    await resetUser(tx, userId)

    await tx`
      INSERT INTO public.users (id, native_language, is_onboarded, last_target_language)
      VALUES (${userId}, ${spec.nativeLanguage}, true, ${spec.targetLanguage})
      ON CONFLICT (id) DO UPDATE SET
        native_language = EXCLUDED.native_language,
        is_onboarded = true,
        last_target_language = EXCLUDED.last_target_language
    `
    await tx`
      INSERT INTO public.user_target_language_prefs (user_id, target_language, cefr_level)
      VALUES (${userId}, ${spec.targetLanguage}, ${spec.cefr})
    `

    // One text source holding every term's example sentence, one segment each.
    const text = spec.terms.map((placed) => placed.term.targetExample).join('\n')
    const [source] = (await tx`
      INSERT INTO public.content_sources (type, title, language, metadata, created_by_user_id)
      VALUES ('text', ${`Dev scenario · ${spec.name}`}, ${spec.targetLanguage},
              ${tx.json({ [SCENARIO_METADATA_KEY]: spec.name })}, ${userId})
      RETURNING id
    `) as [{ id: string }]
    const [track] = (await tx`
      INSERT INTO public.text_tracks (content_source_id, source, language, hash)
      VALUES (${source.id}, 'paste', ${spec.targetLanguage}, ${createHash('sha256').update(text).digest('hex')})
      RETURNING id
    `) as [{ id: string }]
    const segments = (await tx`
      INSERT INTO public.text_segments (text_track_id, index, text)
      SELECT ${track.id}, t.ord - 1, t.text
      FROM unnest(${spec.terms.map((placed) => placed.term.targetExample)}::text[]) WITH ORDINALITY AS t(text, ord)
      RETURNING id, index
    `) as Array<{ id: string; index: number }>
    const segmentIds = new Map(segments.map((segment) => [segment.index, segment.id]))
    const [session] = (await tx`
      INSERT INTO public.study_sessions
        (user_id, content_source_id, text_track_id, native_language, target_language, cefr_level)
      VALUES (${userId}, ${source.id}, ${track.id}, ${spec.nativeLanguage}, ${spec.targetLanguage}, ${spec.cefr})
      RETURNING id
    `) as [{ id: string }]

    for (const [index, placed] of spec.terms.entries()) {
      await insertTerm(tx, { userId, spec, placed, sessionId: session.id, segmentId: segmentIds.get(index)! })
    }

    if (spec.knownLemmas.length > 0) {
      await tx`
        INSERT INTO public.known_lemmas (user_id, target_language, lemma, source, marked_at)
        SELECT ${userId}, ${spec.targetLanguage}, lemma, 'bulk_text', NOW() - interval '30 days'
        FROM unnest(${spec.knownLemmas.map((lemma) => foldCheckpointToken(lemma, spec.targetLanguage))}::text[])
          AS t(lemma)
      `
    }

    for (const placed of spec.terms) {
      const key = prepared.insightKeys.get(placed.term.headword)
      if (!placed.insight || !key) continue
      await writeInsight(tx, {
        targetLanguage: spec.targetLanguage,
        explanationLanguage: prepared.explanationLanguage,
        key,
        mode: placed.insight,
        insight: placed.term.insight,
      })
    }
  })
}

// ---------------------------------------------------------------- verify

// Reads each expected family line through buildWordFamily — the same path the
// flashcard's glosses.wordFamily request takes — and reports every mismatch.
// Insights are cached by seedScenario, so this never generates.
export const verifyScenarioFamilies = async (
  params: { userId: string; prepared: PreparedScenario },
  deps: WordFamilyDependencies
): Promise<string[]> => {
  const { spec, explanationLanguage } = params.prepared
  const problems: string[] = []
  for (const [headword, expected] of Object.entries(spec.expectations.familyAnchors ?? {})) {
    const placed = spec.terms.find((candidate) => candidate.term.headword === headword)
    if (!placed) {
      problems.push(`${headword}: not in the scenario`)
      continue
    }
    const lookup = await loadWordFamilyEntries({ targetLanguage: spec.targetLanguage, selectionText: headword }, deps)
    const family = await buildWordFamily(
      {
        userId: params.userId,
        targetLanguage: spec.targetLanguage,
        explanationLanguage,
        lookup,
        pos: placed.term.grammar.pos,
      },
      deps
    )
    if (family?.insightPending) problems.push(`${headword}: insight not cached`)
    const anchors = (family?.anchors ?? []).map((anchor) => anchor.lemma).sort()
    if (expected === null) {
      const clue = family && (anchors.length > 0 || family.formOf || family.parts?.some((part) => part.meaning))
      if (clue) problems.push(`${headword}: expected no family clue, got anchors [${anchors.join(', ')}]`)
      continue
    }
    const want = [...expected].sort()
    if (anchors.join('|') !== want.join('|')) {
      problems.push(`${headword}: expected anchors [${want.join(', ')}], got [${anchors.join(', ')}]`)
    }
  }
  return problems
}

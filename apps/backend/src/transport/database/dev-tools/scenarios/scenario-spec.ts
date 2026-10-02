import type { ExerciseType } from '../../practice-exercises/practice-exercises-repository'
import type { PracticePool } from '../../study-facets/study-facets-repository'

// Declarative practice scenarios for `pnpm dev:scenario` (see README.md here).
// A scenario names the exact practice state a dev-tunnel user should be in;
// seed-scenario.ts writes it straight into the database, every timestamp
// relative to NOW() so `pnpm db:advance-day` moves it like real data.

// Hand-authored exercise content. Offsets (blank / term spans) are computed
// from the sentence at seed time, never written by hand.
export type CatalogExercises = {
  // One sentence serves mc_cloze (with the distractors) and production_cloze
  // (accepting `answer`); `answer` must occur in `sentence`.
  cloze: { sentence: string; answer: string; distractors: [string, string, string] }
  // `term` must occur in `sentence`; `prompt` and `options` are in the
  // learner's native language.
  comprehension: {
    sentence: string
    term: string
    prompt: string
    options: [string, string, string, string]
    answerIndex: number
  }
}

// A word-family insight as the LLM layer would cache it (word_family_insights
// + one explanation). `partMeanings` aligns with `parts` by index; an empty
// `parts` marks the word opaque (no breakdown line).
export type CatalogInsight = {
  parts: Array<{ text: string; isAffix: boolean }>
  partMeanings: Array<string | null>
  missingParents?: string[]
  hiddenAncestors?: string[]
}

export type CatalogTerm = {
  headword: string
  sense: string
  translation: string
  definition: string
  // Example sentence pair; `surface` is the term's form inside `targetExample`
  // (it becomes the kept card's surface form and its source segment).
  targetExample: string
  nativeExample: string
  surface: string
  grammar: { pos: string; display_form: string } & Record<string, unknown>
  zipf: number
  exercises?: CatalogExercises
  insight?: CatalogInsight
}

// The SRS state one facet starts in.
export type FacetSeed =
  // Scheduled flashcard. Negative `dueInHours` = already due.
  | {
      state: 'review'
      dueInHours: number
      stability: number
      difficulty: number
      reps: number
      lapses: number
      lastReviewDaysAgo: number
      introducedDaysAgo: number
      // Skip the rating-event trail: the schedule came from a silent write
      // (the production→recognition bridge logs no events).
      silent?: boolean
    }
  // Onboarding-parked (warm-up): introduced and parked, never reviewed, with
  // `rehabCorrectDays` gate credits — the last one `lastCorrectDaysAgo` days ago.
  | { state: 'warmup'; introducedDaysAgo: number; rehabCorrectDays: number; lastCorrectDaysAgo: number | null }
  // Enabled but never introduced: a planned introduction for the next compose.
  | { state: 'unseen' }

export type BankSlot = {
  pool: PracticePool
  type: ExerciseType
  // `used` slots are already-answered exercises, `daysAgo` dating the answer.
  status: 'ready' | 'failed' | 'used'
  daysAgo?: number
}

export type ScenarioTerm = {
  term: CatalogTerm
  // Citation facets; a missing key means the facet doesn't exist.
  recognition?: FacetSeed
  production?: FacetSeed
  bank?: BankSlot[]
  // How the term's word-family insight is written:
  // - 'curated': the catalog insight replaces whatever is cached (shared
  //   rows, but a local dev cache), so the family line is deterministic.
  // - 'fill': only when nothing is cached for the explanation language —
  //   enough to keep the practice compose from generating one.
  // - omitted: untouched (terms that never show as flashcards).
  insight?: 'curated' | 'fill'
  // Days since the term was saved; drives user_lookups.created_at and the
  // freshness signals.
  savedDaysAgo: number
}

export type ScenarioSpec = {
  name: string
  description: string
  targetLanguage: string
  nativeLanguage: string
  cefr: string
  terms: ScenarioTerm[]
  // Lemmas marked known (known_lemmas, folded), e.g. word-family anchors.
  knownLemmas: string[]
  expectations: {
    // The language landing's session-plan counts (practice.previewPracticeQueue).
    preview: { new: number; warmup: number; learning: number; review: number }
    // Headword → the family anchors its flashcard line should show (display
    // spellings, any order); null = no family line at all.
    familyAnchors?: Record<string, string[] | null>
  }
  // What to try once signed in, printed by the CLI.
  tryIt: string[]
}

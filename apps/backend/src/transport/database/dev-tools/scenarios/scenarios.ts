import type { BankSlot, CatalogTerm, FacetSeed, ScenarioSpec, ScenarioTerm } from './scenario-spec'
import {
  безопасность,
  внимательный,
  водопад,
  дорога,
  дюжина,
  забывать,
  медленно,
  мрачный,
  объяснять,
  окно,
  перевод,
  переводчик,
  писатель,
  погода,
  подъехать,
  пригород,
  промахнуться,
  решение,
  скучный,
  собака,
  сосед,
  сравнивать,
  требовать,
  удобный,
  улица,
  читатель,
  читать,
} from './ru-catalog'

// The starter scenarios. Each is a complete account state: running one wipes
// the scenario user's content and writes exactly this.

// A settled review card, already due when dueInHours < 0.
const review = (dueInHours: number, overrides: Partial<Extract<FacetSeed, { state: 'review' }>> = {}): FacetSeed => ({
  state: 'review',
  dueInHours,
  stability: 6,
  difficulty: 5,
  reps: 4,
  lapses: 0,
  lastReviewDaysAgo: 6,
  introducedDaysAgo: 20,
  ...overrides,
})

// Scheduled far out: the term exists (a saved relative, a bridged recognition
// sibling) without padding today's queue.
const notDue = review(24 * 30, { stability: 40, reps: 6, lastReviewDaysAgo: 10, introducedDaysAgo: 40 })

// A recognition sibling kept current by the production→recognition bridge.
const bridged = review(24 * 45, { stability: 60, reps: 3, lastReviewDaysAgo: 2, introducedDaysAgo: 30, silent: true })

const RECOGNITION_LADDER: BankSlot[] = [
  { pool: 'recognition', type: 'mc_cloze', status: 'ready' },
  { pool: 'recognition', type: 'mc_comprehension', status: 'ready' },
  { pool: 'recognition', type: 'use_in_sentence', status: 'ready' },
]

const PRODUCTION_LADDER: BankSlot[] = [
  { pool: 'production', type: 'mc_cloze', status: 'ready' },
  { pool: 'production', type: 'production_cloze', status: 'ready' },
  { pool: 'production', type: 'use_in_sentence', status: 'ready' },
]

// Recognition hint = mc_comprehension, production hint = mc_cloze. A failed
// slot hides the Hint button deterministically: an empty bank would make the
// compose kick off a generation instead.
const recognitionHint = (status: 'ready' | 'failed'): BankSlot[] => [
  { pool: 'recognition', type: 'mc_comprehension', status },
]
const productionHint = (status: 'ready' | 'failed'): BankSlot[] => [{ pool: 'production', type: 'mc_cloze', status }]

const dueRecognition = (
  term: CatalogTerm,
  dueInHours: number,
  hint: 'ready' | 'failed',
  insight: 'curated' | 'fill' = 'fill'
): ScenarioTerm => ({
  term,
  recognition: review(dueInHours),
  bank: recognitionHint(hint),
  insight,
  savedDaysAgo: 25,
})

const ruFamilyDue: ScenarioSpec = {
  name: 'ru-family-due',
  description:
    'Russian recognition cards due today; five have word-family relatives the user knows or saved (cached insights), three have none. Half the cards have a banked hint.',
  targetLanguage: 'ru',
  nativeLanguage: 'en',
  cefr: 'B1',
  terms: [
    dueRecognition(писатель, -6, 'ready', 'curated'),
    dueRecognition(читатель, -5, 'failed', 'curated'),
    dueRecognition(переводчик, -4, 'ready', 'curated'),
    dueRecognition(безопасность, -3, 'failed', 'curated'),
    dueRecognition(водопад, -2, 'ready', 'curated'),
    dueRecognition(дюжина, -2, 'failed', 'curated'),
    dueRecognition(собака, -1, 'ready', 'curated'),
    dueRecognition(окно, -1, 'failed', 'curated'),
    // Saved relatives (anchors), scheduled far out.
    { term: читать, recognition: notDue, savedDaysAgo: 45 },
    { term: перевод, recognition: notDue, savedDaysAgo: 45 },
  ],
  knownLemmas: ['писать', 'опасность', 'вода'],
  expectations: {
    preview: { new: 0, warmup: 0, learning: 0, review: 8 },
    familyAnchors: {
      писатель: ['писать'],
      читатель: ['читать'],
      переводчик: ['перевод'],
      безопасность: ['опасность'],
      водопад: ['вода'],
      дюжина: null,
      собака: null,
      окно: null,
    },
  },
  tryIt: [
    'Practice → Russian: the first five cards offer a Clue (word-family line) on the front; дюжина / собака / окно do not.',
    'Hint shows on писатель, переводчик, водопад, собака only.',
  ],
}

const ruLeechEdge: ScenarioSpec = {
  name: 'ru-leech-edge',
  description:
    'One recognition card (забывать, 5 lapses) and one production card (внимательный, 3 lapses) one Again away from leech parking, plus three ordinary due cards. Gate exercises are banked.',
  targetLanguage: 'ru',
  nativeLanguage: 'en',
  cefr: 'B1',
  terms: [
    {
      term: забывать,
      recognition: review(-1, { reps: 11, lapses: 5, stability: 1.2, difficulty: 8.6, lastReviewDaysAgo: 2 }),
      bank: RECOGNITION_LADDER,
      insight: 'fill',
      savedDaysAgo: 60,
    },
    {
      term: внимательный,
      recognition: bridged,
      production: review(-1, { reps: 8, lapses: 3, stability: 1.5, difficulty: 8.2, lastReviewDaysAgo: 2 }),
      bank: PRODUCTION_LADDER,
      insight: 'fill',
      savedDaysAgo: 60,
    },
    dueRecognition(дорога, -3, 'ready'),
    dueRecognition(погода, -2, 'ready'),
    dueRecognition(улица, -1, 'ready'),
  ],
  knownLemmas: [],
  expectations: { preview: { new: 0, warmup: 0, learning: 0, review: 5 } },
  tryIt: [
    'Practice → Russian, rate забывать (recognition) or внимательный (production) Again: the "keeps tripping you up" toast fires and the term parks.',
    'Compose again (or open Strengthen from the completion screen): the parked term serves a rehab gate from the banked exercises.',
  ],
}

const ruWarmupDay2: ScenarioSpec = {
  name: 'ru-warmup-day2',
  description:
    'The day after a warm-up session: five terms introduced and parked yesterday come back as warm-up gates (скучный graduates on a correct answer today), two new terms are planned introductions, three review cards are due.',
  targetLanguage: 'ru',
  nativeLanguage: 'en',
  cefr: 'B1',
  terms: [
    ...[сосед, пригород, мрачный].map((term): ScenarioTerm => ({
      term,
      recognition: { state: 'warmup', introducedDaysAgo: 1, rehabCorrectDays: 1, lastCorrectDaysAgo: 1 },
      bank: [...RECOGNITION_LADDER, { pool: 'recognition', type: 'mc_cloze', status: 'used', daysAgo: 1 }],
      savedDaysAgo: 3,
    })),
    // Introduced yesterday but skipped: still uncredited.
    {
      term: забывать,
      recognition: { state: 'warmup', introducedDaysAgo: 1, rehabCorrectDays: 0, lastCorrectDaysAgo: null },
      bank: RECOGNITION_LADDER,
      savedDaysAgo: 3,
    },
    // Credited on two earlier days: a correct answer today graduates it.
    {
      term: скучный,
      recognition: { state: 'warmup', introducedDaysAgo: 2, rehabCorrectDays: 2, lastCorrectDaysAgo: 1 },
      bank: [
        ...RECOGNITION_LADDER,
        { pool: 'recognition', type: 'mc_cloze', status: 'used', daysAgo: 2 },
        { pool: 'recognition', type: 'mc_comprehension', status: 'used', daysAgo: 1 },
      ],
      savedDaysAgo: 4,
    },
    ...[промахнуться, подъехать].map((term): ScenarioTerm => ({
      term,
      recognition: { state: 'unseen' },
      bank: RECOGNITION_LADDER,
      savedDaysAgo: 2,
    })),
    dueRecognition(дорога, -3, 'ready'),
    dueRecognition(погода, -2, 'ready'),
    dueRecognition(улица, -1, 'ready'),
  ],
  knownLemmas: [],
  expectations: { preview: { new: 2, warmup: 5, learning: 0, review: 3 } },
  tryIt: [
    'Practice → Russian: warm-up gates for the five parked terms, two "New" introductions, three review cards.',
    'Answer скучный correctly to see the graduation celebration; others show "Day 2 of 3".',
    'Then `pnpm db:advance-day --email <scenario email>`: the credited terms come back for day 3.',
  ],
}

const ruProductionHints: ScenarioSpec = {
  name: 'ru-production-hints',
  description:
    'A production-only session: six production cards due, five with a banked hint exercise (сравнивать has none). Recognition siblings are scheduled far out.',
  targetLanguage: 'ru',
  nativeLanguage: 'en',
  cefr: 'B1',
  terms: [
    ...[требовать, объяснять, решение, удобный, медленно].map((term, index): ScenarioTerm => ({
      term,
      recognition: bridged,
      production: review(-(index + 1)),
      bank: productionHint('ready'),
      insight: 'fill',
      savedDaysAgo: 30,
    })),
    {
      term: сравнивать,
      recognition: bridged,
      production: review(-6),
      bank: productionHint('failed'),
      insight: 'fill',
      savedDaysAgo: 30,
    },
  ],
  knownLemmas: [],
  expectations: { preview: { new: 0, warmup: 0, learning: 0, review: 6 } },
  tryIt: [
    'Practice → Russian: six production cards; Hint (an mc_cloze) is available on all but сравнивать.',
    'Answering a hint locks the rating (correct → Hard, wrong → Again).',
  ],
}

const dueProduction = (
  term: CatalogTerm,
  dueInHours: number,
  hint: 'ready' | 'failed',
  insight: 'curated' | 'fill' = 'fill'
): ScenarioTerm => ({
  term,
  recognition: bridged,
  production: review(dueInHours),
  bank: productionHint(hint),
  insight,
  savedDaysAgo: 30,
})

const ruProductionFamily: ScenarioSpec = {
  name: 'ru-production-family',
  description:
    'Russian production cards due today; five have explained word-family insights (a meaning-only Clue), three are opaque. Some cards also have a banked hint.',
  targetLanguage: 'ru',
  nativeLanguage: 'en',
  cefr: 'B1',
  terms: [
    dueProduction(писатель, -6, 'ready', 'curated'),
    dueProduction(читатель, -5, 'failed', 'curated'),
    dueProduction(переводчик, -4, 'failed', 'curated'),
    dueProduction(безопасность, -3, 'failed', 'curated'),
    dueProduction(водопад, -2, 'ready', 'curated'),
    dueProduction(дюжина, -2, 'ready', 'curated'),
    dueProduction(собака, -1, 'failed', 'curated'),
    dueProduction(окно, -1, 'failed', 'curated'),
    // Saved relatives (anchors), scheduled far out.
    { term: читать, recognition: notDue, savedDaysAgo: 45 },
    { term: перевод, recognition: notDue, savedDaysAgo: 45 },
  ],
  knownLemmas: ['писать', 'опасность', 'вода'],
  expectations: {
    preview: { new: 0, warmup: 0, learning: 0, review: 8 },
    familyAnchors: {
      писатель: ['писать'],
      читатель: ['читать'],
      переводчик: ['перевод'],
      безопасность: ['опасность'],
      водопад: ['вода'],
      дюжина: null,
      собака: null,
      окно: null,
    },
  },
  tryIt: [
    'Practice → Russian: the first five production cards offer a Clue with part meanings only — no Russian on the front.',
    'писатель marks its root "(a word you know)", читатель "(a word you saved)"; переводчик / безопасность mention no relative.',
    'дюжина / собака / окно have no Clue. Hint (mc_cloze) shows on писатель, водопад, дюжина only.',
    'After the Clue, Easy is off; Clue then Hint → the Hint lock (Hard/Again) wins.',
    'Settings → turn Russian translations off: no production Clue.',
  ],
}

export const SCENARIOS: readonly ScenarioSpec[] = [
  ruFamilyDue,
  ruLeechEdge,
  ruWarmupDay2,
  ruProductionHints,
  ruProductionFamily,
]

export const findScenario = (name: string): ScenarioSpec | undefined =>
  SCENARIOS.find((scenario) => scenario.name === name)

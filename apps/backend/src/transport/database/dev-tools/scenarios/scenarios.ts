import type { BankSlot, CatalogTerm, FacetSeed, ScenarioSpec, ScenarioTerm } from './scenario-spec'
import {
  безопасность,
  буфет,
  внимательный,
  водопад,
  дорога,
  дюжина,
  забывать,
  завтрак,
  медленно,
  мрачный,
  объяснять,
  окно,
  перевод,
  переводчик,
  писатель,
  погода,
  подъехать,
  парк,
  пригород,
  промахнуться,
  решение,
  скучный,
  собака,
  сосед,
  сравнивать,
  театр,
  требовать,
  удобный,
  улица,
  учить,
  формат,
  церковь,
  читатель,
  читать,
  ярмарка,
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

// The "Translate & add" row states: each word is found by searching its
// English meaning (production tested) unless noted, and shows one state.
const ruCaptureStates: ScenarioSpec = {
  name: 'ru-capture-states',
  description:
    'Saved Russian words in every "Translate & add" row state: a far-due card to pull forward, due tomorrow, learning, no production card, production paused, and a never-started word.',
  targetLanguage: 'ru',
  nativeLanguage: 'en',
  cefr: 'B1',
  terms: [
    // "dog": due in 23 days → Review tomorrow.
    { term: собака, production: review(24 * 23), recognition: notDue, savedDaysAgo: 40 },
    // "window": due tomorrow, nothing to pull forward.
    { term: окно, production: review(24), recognition: notDue, savedDaysAgo: 40 },
    // "waterfall": still in learning steps, due today.
    {
      term: водопад,
      production: review(-1, { phase: 'learning', stability: 1, reps: 1, lastReviewDaysAgo: 0, introducedDaysAgo: 0 }),
      recognition: notDue,
      bank: productionHint('failed'),
      insight: 'fill',
      savedDaysAgo: 40,
    },
    // "to read": recognition only → Add production.
    { term: читать, recognition: notDue, savedDaysAgo: 45 },
    // "translation": production paused with its schedule → Resume production.
    {
      term: перевод,
      recognition: notDue,
      production: review(24 * 12, { paused: true }),
      savedDaysAgo: 45,
    },
    // "writer": never started → the search moves it up (Undo, then Move up).
    { term: писатель, recognition: { state: 'unseen' }, bank: RECOGNITION_LADDER, insight: 'fill', savedDaysAgo: 20 },
    // Search "дюжина" (Russian, so recognition is tested): due in 23 days.
    { term: дюжина, recognition: review(24 * 23), savedDaysAgo: 40 },
  ],
  knownLemmas: [],
  expectations: {
    preview: { new: 1, warmup: 0, learning: 1, review: 0 },
  },
  tryIt: [
    'Add a word (Russian) → "dog": Due in 23 days · Review tomorrow → ✓ Due tomorrow · Undo.',
    '"window": Due tomorrow. "waterfall": Learning · due today.',
    '"to read": No production card · Add production → ✓ Production added · Undo.',
    '"translation": Production paused · Resume production → its schedule · Undo.',
    '"writer": ✓ Moved up · Undo → Not started · Move up.',
    '"дюжина": a Russian search tests recognition — Due in 23 days · Review tomorrow.',
  ],
}

// The reader's declaration flow: every lane of a checkpoint in one short text.
const ruReaderCloseout: ScenarioSpec = {
  name: 'ru-reader-closeout',
  description:
    'An unread Russian text for the reader close-out: three saved words due for review appear in it, three saved words were never practiced, one was saved too recently to offer, and the rest of its words are unmarked.',
  targetLanguage: 'ru',
  nativeLanguage: 'en',
  cefr: 'B1',
  terms: [
    // Due and in the text → the reviews list.
    dueRecognition(собака, -6, 'failed'),
    dueRecognition(окно, -4, 'failed'),
    dueRecognition(водопад, -2, 'failed'),
    // In the text but not due → listed nowhere.
    { term: читать, recognition: notDue, savedDaysAgo: 45 },
    // Never practiced, saved long ago → the "saved but never practiced" step.
    // Each appears in its dictionary form: an inflected-only match would go
    // through the LLM confirm pass, whose verdict varies between runs.
    { term: писатель, recognition: { state: 'unseen' }, bank: RECOGNITION_LADDER, insight: 'fill', savedDaysAgo: 20 },
    { term: дюжина, recognition: { state: 'unseen' }, bank: RECOGNITION_LADDER, insight: 'fill', savedDaysAgo: 20 },
    { term: решение, recognition: { state: 'unseen' }, bank: RECOGNITION_LADDER, insight: 'fill', savedDaysAgo: 20 },
    // Never practiced but saved two days ago: a recent save is evidence the
    // word was NOT known, so it is not offered.
    { term: улица, recognition: { state: 'unseen' }, bank: RECOGNITION_LADDER, insight: 'fill', savedDaysAgo: 2 },
  ],
  knownLemmas: [],
  reading: {
    title: 'Dev scenario · Сосед-писатель',
    segments: [
      'Вчера утром я вышел на улицу и увидел соседскую собаку.',
      'Она сидела у дороги и смотрела на моё окно.',
      'Мой сосед — писатель, он живёт в пригороде уже много лет.',
      'Он рассказал мне, что у него вышла уже дюжина рассказов о горах.',
      'В одном из них герой долго идёт к водопаду.',
      'Погода портится, но он принимает решение не возвращаться.',
      'Я люблю читать такие истории по вечерам.',
      'Вечером я открыл окно и снова услышал, как лает собака.',
      'Писателя я больше в тот день не видел.',
      'Наверное, он работал над новой книгой.',
    ],
  },
  expectations: {
    preview: { new: 4, warmup: 0, learning: 0, review: 3 },
  },
  tryIt: [
    'The link opens the text. The close-out card sits under the last line; the footer pill counts the unmarked words (give the word profile a few seconds to build on first open).',
    '"I understood everything" → the reviews list: собака, окно, водопад, each with its sentence. читать is in the text but not due, so it is absent.',
    'Uncheck окно → "Collect 2 reviews". Practice → Russian then still shows окно due.',
    'Next step: писатель, дюжина, решение (saved but never practiced). улица is missing — it was saved two days ago.',
    'Last step: "Mark the N remaining words as known?", then one toast with Undo for the whole run.',
    'Skip the never-practiced step instead: the close-out card keeps a "words you may already know" button that reopens it, also after a reload.',
    'Gloss a word (tap собаку) before collecting: it drops out of the reviews list.',
    'Re-run pnpm dev:scenario ru-reader-closeout to start over.',
  ],
}

// The extension's declaration flow on a real video: saved words that are
// spoken, in their dictionary form, in the first five minutes of
// youtube.com/watch?v=UEwZLOt3HvM. No session is seeded — the extension
// creates it on the first tap, as for any viewer, so the scenario doesn't
// depend on the hash of the subtitle track YouTube serves.
const ruVideoDeclaration: ScenarioSpec = {
  name: 'ru-video-declaration',
  description:
    'Saved Russian words for the extension declaration sheet on youtube.com/watch?v=UEwZLOt3HvM: three due words and three never-practiced ones are spoken in its first five minutes, plus one that is not due and one saved too recently.',
  targetLanguage: 'ru',
  nativeLanguage: 'en',
  cefr: 'B1',
  terms: [
    // Due and spoken (0:53, 1:02, 3:07) → the reviews list.
    dueRecognition(церковь, -6, 'failed'),
    dueRecognition(ярмарка, -4, 'failed'),
    dueRecognition(буфет, -2, 'failed'),
    // Spoken (2:34) but not due → listed nowhere.
    { term: учить, recognition: notDue, savedDaysAgo: 45 },
    // Never practiced, saved long ago, spoken at 4:12, 4:28, 4:55 → the
    // "saved but never practiced" step. Each is heard in its dictionary form:
    // an inflected-only match would go through the LLM confirm pass, whose
    // verdict varies between runs.
    { term: формат, recognition: { state: 'unseen' }, bank: RECOGNITION_LADDER, insight: 'fill', savedDaysAgo: 20 },
    { term: завтрак, recognition: { state: 'unseen' }, bank: RECOGNITION_LADDER, insight: 'fill', savedDaysAgo: 20 },
    { term: театр, recognition: { state: 'unseen' }, bank: RECOGNITION_LADDER, insight: 'fill', savedDaysAgo: 20 },
    // Spoken (1:10) but saved two days ago: a recent save is evidence the
    // word was NOT known, so it is not offered.
    { term: парк, recognition: { state: 'unseen' }, bank: RECOGNITION_LADDER, insight: 'fill', savedDaysAgo: 2 },
  ],
  knownLemmas: [],
  expectations: {
    preview: { new: 4, warmup: 0, learning: 0, review: 3 },
  },
  tryIt: [
    'Needs the backend running (the first tap creates the video session: one language-detection call, then the word profile builds) and the extension dev build signed in as <scenario email>: open the link, press Verify, then pair the extension from the web app.',
    'Open https://www.youtube.com/watch?v=UEwZLOt3HvM with its Russian subtitles loaded, play past 5:00, pause, and tap the declaration button on the controls bar.',
    'Reviews list: церковь, ярмарка, буфет, each with its subtitle line. учить is spoken but not due, so it is absent.',
    'Uncheck ярмарка → "Collect 2 reviews". Practice → Russian then still shows ярмарка due.',
    'Next step: формат, завтрак, театр (saved but never practiced). парк is missing — it was saved two days ago.',
    'Last step: "Mark the N remaining words as known?" (give the word profile a few seconds on the first run), then one toast with Undo for the whole run.',
    'Pause before 3:07 instead: буфет drops out of the reviews list and the never-practiced step is skipped.',
    'Re-run pnpm dev:scenario ru-video-declaration to start over; the extension notices the deleted session on the next tap.',
  ],
}

export const SCENARIOS: readonly ScenarioSpec[] = [
  ruFamilyDue,
  ruLeechEdge,
  ruWarmupDay2,
  ruProductionHints,
  ruProductionFamily,
  ruCaptureStates,
  ruReaderCloseout,
  ruVideoDeclaration,
]

export const findScenario = (name: string): ScenarioSpec | undefined =>
  SCENARIOS.find((scenario) => scenario.name === name)

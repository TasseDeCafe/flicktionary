// Pure ranking logic for the offline lemma_ranks build
// (apps/backend/scripts/build-lemma-ranks.ts). Implements the spike-validated
// build rules from docs/proposals/vocab-coverage-visualization.md: ambiguous
// forms split their corpus mass across candidate lemmas weighted by each
// candidate's own corpus frequency (never evenly), German capitalized lemmas
// are discounted when their lowercase twin competes for the same form, and
// the denominator only ever contains real word tokens of the language's
// script. Everything here is deterministic and unit-tested; DB access and
// wordfreq I/O stay in the script.

// Applied to checkpoint_fold-folded forms (already lowercase, ru stress and ё
// folded away, de ß→ss), so the character classes never need uppercase, ё,
// or ß. Digits, latin loans in ru, symbols, and mixed-script tokens are out;
// single letters stay in — one-letter words are real (ru в/и/я, en a/i) and
// letter-name noise is already excluded by the pos <> 'character' filter on
// the resolution side.
const REAL_WORD_TOKEN_PATTERNS: Record<string, RegExp> = {
  ru: /^[а-я]+(?:-[а-я]+)*$/,
  de: /^[a-zäöü]+(?:-[a-zäöü]+)*$/,
  en: /^[a-z]+(?:['’-][a-z]+)*$/,
  es: /^[a-záéíóúüñ]+(?:-[a-záéíóúüñ]+)*$/,
  // Hyphen groups cover enclitic spellings (queixar-se, dá-lo).
  pt: /^[a-záàâãéêíóôõúüç]+(?:-[a-záàâãéêíóôõúüç]+)*$/,
}

export const isRealWordToken = (foldedForm: string, targetLanguage: string): boolean => {
  const pattern = REAL_WORD_TOKEN_PATTERNS[targetLanguage]
  if (!pattern) throw new Error(`No real-word-token pattern for language ${targetLanguage}`)
  return pattern.test(foldedForm)
}

// wordfreq is caseless, so a capitalized German lemma (Auch, the town) and
// its lowercase twin (auch) would otherwise split a form's mass 50/50 on the
// same frequency lookup. When both spellings compete for one form, the
// capitalized candidate keeps 2% of its weight (spike-validated constant).
export const DE_CASE_TWIN_DISCOUNT = 0.02

export type FormCandidate = {
  // Raw kaikki headword, case preserved — the case-twin discount needs it.
  lemma: string
  // checkpoint_fold(lemma) — the canonical key mass accumulates under.
  foldedLemma: string
}

// Splits one form's corpus mass across its candidate lemmas, weighted by each
// candidate's own corpus frequency (epsilon for lemmas wordfreq doesn't
// list). Returns mass per FOLDED lemma; raw same-fold candidates (de
// sein/Sein) simply pool their shares under one key.
export const splitFormMass = (params: {
  formFrequency: number
  candidates: readonly FormCandidate[]
  targetLanguage: string
  frequencyOfFoldedLemma: (foldedLemma: string) => number | undefined
  epsilonWeight: number
}): Map<string, number> => {
  const result = new Map<string, number>()
  if (params.candidates.length === 0 || params.formFrequency <= 0) return result

  const rawLemmas = new Set(params.candidates.map((c) => c.lemma))
  const weights = params.candidates.map((candidate) => {
    let weight = params.frequencyOfFoldedLemma(candidate.foldedLemma) ?? params.epsilonWeight
    if (weight <= 0) weight = params.epsilonWeight
    if (
      params.targetLanguage === 'de' &&
      candidate.lemma !== candidate.lemma.toLowerCase() &&
      rawLemmas.has(candidate.lemma.toLowerCase())
    ) {
      weight *= DE_CASE_TWIN_DISCOUNT
    }
    return weight
  })

  const totalWeight = weights.reduce((sum, w) => sum + w, 0)
  for (let i = 0; i < params.candidates.length; i++) {
    const share = (params.formFrequency * weights[i]) / totalWeight
    const key = params.candidates[i].foldedLemma
    result.set(key, (result.get(key) ?? 0) + share)
  }
  return result
}

export type RankedLemma = {
  lemma: string
  rank: number
  freqMass: number
}

// Deterministic ranking: mass descending, folded lemma ascending on ties.
//
// The mass floor keeps only lemmas carrying at least as much mass as the
// rarest form wordfreq can measure (the caller passes minListedFrequency).
// Below it sit lemmas whose entire mass is epsilon-share slivers of forms
// dominated by other candidates (alt-spellings, acronym redirects — "becuz",
// "MI5"): their near-identical masses would rank them as a dense plateau of
// junk deep in the list, and their rank order is corpus noise. A lemma
// wordfreq doesn't list itself still ranks fine when it's the sole candidate
// of a listed form — it inherits the form's full mass and clears the floor.
export const rankLemmas = (massByLemma: ReadonlyMap<string, number>, massFloor = 0): RankedLemma[] => {
  return [...massByLemma.entries()]
    .filter(([, mass]) => mass > 0 && mass >= massFloor)
    .sort(([lemmaA, massA], [lemmaB, massB]) => massB - massA || lemmaA.localeCompare(lemmaB))
    .map(([lemma, freqMass], i) => ({ lemma, rank: i + 1, freqMass }))
}

// Automated acceptance gate — the build fails loud instead of publishing a
// silently degraded list. Thresholds sit under the spike results (ru 97.6% /
// de 96.6% token mass matched; ~16k / ~30k lemmas from a 50k-form input —
// the 100k-form build only widens both).
export const MIN_MASS_MATCHED_PCT = 95
export const MIN_LEMMA_COUNT = 8_000
export const MAX_LEMMA_COUNT = 150_000

export type AcceptanceInput = {
  totalWordTokenMass: number
  matchedWordTokenMass: number
  lemmaCount: number
}

export type AcceptanceResult = {
  massMatchedPct: number
  failures: string[]
}

export const checkAcceptance = (input: AcceptanceInput): AcceptanceResult => {
  const massMatchedPct =
    input.totalWordTokenMass > 0 ? (input.matchedWordTokenMass / input.totalWordTokenMass) * 100 : 0
  const failures: string[] = []
  if (massMatchedPct < MIN_MASS_MATCHED_PCT) {
    failures.push(
      `token-mass matched ${massMatchedPct.toFixed(2)}% is below the ${MIN_MASS_MATCHED_PCT}% acceptance threshold`
    )
  }
  if (input.lemmaCount < MIN_LEMMA_COUNT) {
    failures.push(`denominator has ${input.lemmaCount} lemmas, below the sane minimum ${MIN_LEMMA_COUNT}`)
  }
  if (input.lemmaCount > MAX_LEMMA_COUNT) {
    failures.push(`denominator has ${input.lemmaCount} lemmas, above the sane maximum ${MAX_LEMMA_COUNT}`)
  }
  return { massMatchedPct, failures }
}

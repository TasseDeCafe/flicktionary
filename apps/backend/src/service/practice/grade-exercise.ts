import { PRODUCTION_CLOZE_MAX_EDIT_DISTANCE } from './leech-config'

// Deterministic exercise grading. Answer truth never leaves the server —
// served payloads are stripped of answer/answerIndex/acceptedForms, and the
// comparison happens here against the stored payload.

// Typed answers are compared accent-insensitively and case-insensitively:
// NFD-decompose, strip combining diacritics, lowercase, trim. A learner who
// types "Arbol" for "árbol" knows the word.
export const normalizeTypedAnswer = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()

// Damerau–Levenshtein distance (optimal string alignment variant: insertions,
// deletions, substitutions, adjacent transpositions). Small local helper — no
// dependency; inputs are single words/short phrases so O(n*m) is nothing.
export const damerauLevenshtein = (a: string, b: string): number => {
  const n = a.length
  const m = b.length
  if (n === 0) return m
  if (m === 0) return n
  // (n+1) x (m+1) distance matrix as nested arrays.
  const d: number[][] = Array.from({ length: n + 1 }, (_, i) =>
    Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1, // deletion
        d[i]![j - 1]! + 1, // insertion
        d[i - 1]![j - 1]! + cost // substitution
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1) // transposition
      }
    }
  }
  return d[n]![m]!
}

// MC types: index equality against the stored answerIndex.
export const gradeMcAnswer = (payload: { answerIndex: number }, selectedIndex: number): boolean =>
  selectedIndex === payload.answerIndex

// Production cloze: exact normalized match against any accepted form, or
// within the typo tolerance of the canonical answer. The tolerance applies to
// the NORMALIZED strings, so a missing accent plus one typo still passes
// (accent stripping is free, the typo costs the edit).
export const gradeProductionClozeAnswer = (
  payload: { answer: string; acceptedForms?: string[] },
  text: string
): boolean => {
  const typed = normalizeTypedAnswer(text)
  if (typed.length === 0) return false
  const accepted = [payload.answer, ...(payload.acceptedForms ?? [])].map(normalizeTypedAnswer)
  if (accepted.includes(typed)) return true
  return accepted.some((form) => damerauLevenshtein(typed, form) <= PRODUCTION_CLOZE_MAX_EDIT_DISTANCE)
}

import { isTypedAnswerAccepted } from '@flicktionary/core/utils/typed-answer-grading'

// Deterministic exercise grading. Answer truth never leaves the server —
// served payloads are stripped of answer/answerIndex/acceptedForms, and the
// comparison happens here against the stored payload. The normalization +
// edit-distance primitives live in @flicktionary/core so the client-graded
// session recap shares the exact same acceptance rules.
export { damerauLevenshtein, normalizeTypedAnswer } from '@flicktionary/core/utils/typed-answer-grading'

// MC types: index equality against the stored answerIndex.
export const gradeMcAnswer = (payload: { answerIndex: number }, selectedIndex: number): boolean =>
  selectedIndex === payload.answerIndex

// Production cloze: exact normalized match against any accepted form, or
// within the typo tolerance of one of them.
export const gradeProductionClozeAnswer = (
  payload: { answer: string; acceptedForms?: string[] },
  text: string
): boolean => isTypedAnswerAccepted([payload.answer, ...(payload.acceptedForms ?? [])], text)

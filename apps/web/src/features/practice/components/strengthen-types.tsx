// Shared answer-response shape passed up from exercise components to the
// Strengthen session orchestrator (which renders rehab progress on it).
export type ExerciseAnswerData = {
  correct: boolean
  feedback: string | null
  gated: boolean
  correctIndex: number | null
  correctAnswer: string | null
}

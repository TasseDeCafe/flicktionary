import { useLingui } from '@lingui/react/macro'
import { PartyPopper, TrendingUp } from 'lucide-react'

// Shared answer-response shape passed up from exercise components to the
// Strengthen session orchestrator (which renders rehab progress on it).
export type ExerciseAnswerData = {
  correct: boolean
  feedback: string | null
  gated: boolean
  correctIndex: number | null
  correctAnswer: string | null
  // Rehab progress (gate exercises on parked terms only).
  rehabCorrectDays: number | null
  graduated: boolean
}

// "Day N of 3" / graduation note rendered under a gate exercise's result.
// rehabCorrectDays is null for bonus exercises and non-parked terms.
export const RehabProgressNote = ({ data }: { data: ExerciseAnswerData }) => {
  const { t } = useLingui()
  if (data.rehabCorrectDays == null) return null
  if (data.graduated) {
    return (
      <div className='flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800'>
        <PartyPopper className='h-4 w-4 shrink-0' />
        {t`Graduated! This term is back in your practice rotation.`}
      </div>
    )
  }
  const days = data.rehabCorrectDays
  return (
    <div className='flex items-center gap-2 rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-800'>
      <TrendingUp className='h-4 w-4 shrink-0' />
      {data.correct
        ? t`Day ${days} of 3 — come back tomorrow for the next step.`
        : t`Rehab progress: day ${days} of 3. A correct answer today still counts — try again with a fresh exercise.`}
    </div>
  )
}

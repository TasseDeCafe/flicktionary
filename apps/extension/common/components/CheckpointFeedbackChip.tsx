import { useLingui } from '@lingui/react/macro'
import { plural } from '@lingui/core/macro'
import { cn } from '@flicktionary/core/utils/tailwind-utils'

export type CheckpointFeedback =
  | { kind: 'success'; creditedCount: number; sessionId: string; checkpointId: string }
  | { kind: 'info'; text: string }
  | { kind: 'error'; text: string }

interface Props {
  feedback: CheckpointFeedback
  onUndo: (sessionId: string, checkpointId: string) => void
}

// Post-checkpoint feedback pill. Rendered by the controls overlay's shadow app
// but OUTSIDE the pause-controls visibility gate: pressing play hides the
// controls bar, and the undo affordance must survive that (its own ~8s
// lifetime is owned by VideoOverlayController). Same white-on-black chrome as
// the controls bar — it sits on video.
export const CheckpointFeedbackChip = ({ feedback, onUndo }: Props) => {
  const { t } = useLingui()

  return (
    <div
      className={cn(
        'pointer-events-auto inline-flex items-center gap-2 rounded-2xl bg-black/70 px-4 py-2 text-sm text-white'
      )}
    >
      {feedback.kind === 'success' ? (
        <>
          <span>{plural(feedback.creditedCount, { one: '# review collected', other: '# reviews collected' })}</span>
          <button
            type='button'
            className='cursor-pointer rounded-full px-2 py-0.5 font-medium underline underline-offset-2 hover:bg-white/10'
            onClick={() => onUndo(feedback.sessionId, feedback.checkpointId)}
          >
            {t`Undo`}
          </button>
        </>
      ) : (
        <span className={feedback.kind === 'error' ? 'text-red-300' : undefined}>{feedback.text}</span>
      )}
    </div>
  )
}

export default CheckpointFeedbackChip

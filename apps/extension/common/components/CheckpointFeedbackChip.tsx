import { cn } from '@flicktionary/core/utils/tailwind-utils'

export type CheckpointFeedback = { kind: 'info'; text: string } | { kind: 'error'; text: string }

interface Props {
  feedback: CheckpointFeedback
}

// Checkpoint info/error pill ("Nothing to collect yet.", unsupported-language
// notice, coded errors). The success/undo affordance lives in the declaration
// sheet's done step instead. Rendered by the controls overlay's shadow app but
// OUTSIDE the pause-controls visibility gate: pressing play hides the controls
// bar, and the feedback must survive that (its own ~8s lifetime is owned by
// VideoOverlayController). Same white-on-black chrome as the controls bar — it
// sits on video.
export const CheckpointFeedbackChip = ({ feedback }: Props) => {
  return (
    <div
      className={cn(
        'pointer-events-auto inline-flex items-center gap-2 rounded-2xl bg-black/70 px-4 py-2 text-sm text-white'
      )}
    >
      <span className={feedback.kind === 'error' ? 'text-red-300' : undefined}>{feedback.text}</span>
    </div>
  )
}

export default CheckpointFeedbackChip

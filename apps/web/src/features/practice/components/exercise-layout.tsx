import type { ReactNode } from 'react'

// Shared Strengthen-exercise scaffold matching the flashcard view's shape:
// scrollable content on top, actions pinned in a bordered bottom bar. Keeps
// the primary button in a stable thumb-reach position instead of trailing the
// content (where a tall textarea would push it around). The bottom bar's
// padding/gap mirror the flashcard bar so the composed queue's status row
// doesn't jump vertically when the queue alternates between item types.
export const ExerciseLayout = ({
  header,
  children,
  feedback,
  statusBar,
  actions,
}: {
  header: ReactNode
  children: ReactNode
  // Post-answer feedback (verdict, expected answer, meaning line, rehab
  // progress) pinned into the bottom bar so it's always visible — in the
  // scrollable body it routinely landed below the fold on small screens. The
  // bar is bottom-anchored, so it grows upward: the status row and actions
  // never move. Height-capped with internal scroll so long LLM feedback
  // (use_in_sentence) can't eat the viewport.
  feedback?: ReactNode
  // Optional queue-status row (peek chevrons + remaining-count chips) pinned
  // above the actions. The composed queue passes it so exercises and
  // flashcards share one status UI; the dedicated warmup/strengthen sessions
  // show a position counter in the header instead.
  statusBar?: ReactNode
  actions: ReactNode
}) => (
  <div className='flex flex-1 flex-col overflow-hidden'>
    <div className='flex-1 overflow-y-auto'>
      <div className='mx-auto flex w-full max-w-xl flex-col gap-5 px-4 py-6'>
        {header}
        {children}
      </div>
    </div>
    <div className='bg-background border-t px-4 py-3'>
      <div className='mx-auto flex w-full max-w-xl flex-col gap-3'>
        {feedback && <div className='max-h-[35vh] overflow-y-auto'>{feedback}</div>}
        {statusBar}
        {actions}
      </div>
    </div>
  </div>
)

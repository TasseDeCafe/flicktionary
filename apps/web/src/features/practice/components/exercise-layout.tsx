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
  statusBar,
  actions,
}: {
  header: ReactNode
  children: ReactNode
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
        {statusBar}
        {actions}
      </div>
    </div>
  </div>
)

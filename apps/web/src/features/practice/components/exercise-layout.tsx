import type { ReactNode } from 'react'

// Shared Strengthen-exercise scaffold matching the flashcard view's shape:
// scrollable content on top, actions pinned in a bordered bottom bar. Keeps
// the primary button in a stable thumb-reach position instead of trailing the
// content (where a tall textarea would push it around).
export const ExerciseLayout = ({
  header,
  children,
  actions,
}: {
  header: ReactNode
  children: ReactNode
  actions: ReactNode
}) => (
  <div className='flex flex-1 flex-col overflow-hidden'>
    <div className='flex-1 overflow-y-auto'>
      <div className='mx-auto flex w-full max-w-xl flex-col gap-5 px-4 py-6'>
        {header}
        {children}
      </div>
    </div>
    <div className='border-t bg-background px-4 pt-2 pb-3'>
      <div className='mx-auto flex w-full max-w-xl flex-col gap-2'>{actions}</div>
    </div>
  </div>
)

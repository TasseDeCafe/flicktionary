import { useLingui } from '@lingui/react/macro'
import { BookOpen } from 'lucide-react'

export const VocabularyEmptyState = () => {
  const { t } = useLingui()
  return (
    <div className='flex flex-col items-center gap-3 rounded-xl border bg-yellow-50 p-8 text-center'>
      <BookOpen className='h-8 w-8 text-yellow-600' />
      <h2 className='font-semibold'>{t`No vocabulary yet`}</h2>
      <p className='text-muted-foreground max-w-sm text-sm'>
        {t`Process a session and keep some cards. They'll show up here, browsable across every session.`}
      </p>
    </div>
  )
}

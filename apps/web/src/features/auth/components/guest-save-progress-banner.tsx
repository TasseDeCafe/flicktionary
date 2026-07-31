import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { UserRoundPlus } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Button } from '@flicktionary/ui/components/button'
import { getIsAnonymous, useAuthStore } from '@/stores/auth-store'

// Persistent (deliberately non-dismissible) guest CTA: an anonymous account is
// unrecoverable once the browser's data is cleared, and that is the honest
// pitch for converting it into a permanent one.
export const GuestSaveProgressBanner = ({ className }: { className?: string }) => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const isAnonymous = useAuthStore(getIsAnonymous)

  if (!isAnonymous) return null

  return (
    <div className={cn('border-border bg-accent/40 flex flex-col gap-3 rounded-xl border p-4', className)}>
      <div className='flex items-start gap-3'>
        <UserRoundPlus className='text-foreground mt-0.5 size-5 shrink-0' />
        <div className='flex flex-col gap-1'>
          <p className='font-semibold'>{t`Save your progress`}</p>
          <p className='text-muted-foreground text-sm'>
            {t`You're browsing as a guest — everything you save lives only in this browser. Create a free account to keep it.`}
          </p>
        </div>
      </div>
      <Button size='lg' className='w-full sm:w-auto sm:self-start' onClick={() => navigate({ to: '/save-progress' })}>
        {t`Create account`}
      </Button>
    </div>
  )
}

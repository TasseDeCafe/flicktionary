import { useCallback, useMemo, useState } from 'react'
import {
  OverlayContent,
  OverlayDescription,
  OverlayHeader,
  OverlayTitle,
  useCloseOverlay,
} from '@/components/ui/responsive-overlay'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDeleteAccount } from '@/features/removals/api/removals-hooks'
import { useLingui } from '@lingui/react/macro'

const EXPECTED_CONFIRMATION_TEXT = 'I want to delete my account'

export const DeleteAccountOverlayContent = () => {
  const { t } = useLingui()
  const closeOverlay = useCloseOverlay()
  const [confirmationText, setConfirmationText] = useState('')

  const isConfirmationValid = useMemo(() => {
    return confirmationText === EXPECTED_CONFIRMATION_TEXT
  }, [confirmationText])

  const { mutate: deleteAccount, isPending } = useDeleteAccount()

  const handleDeleteAccount = useCallback(() => {
    if (isConfirmationValid) {
      deleteAccount({ type: 'account' })
    }
  }, [deleteAccount, isConfirmationValid])

  const handleCancel = useCallback(() => {
    setConfirmationText('')
    closeOverlay()
  }, [closeOverlay])

  return (
    <OverlayContent className='sm:max-w-md'>
      <OverlayHeader>
        <OverlayTitle className='text-center'>{t`Are you absolutely sure?`}</OverlayTitle>
        <OverlayDescription className='text-center'>
          {t`This action cannot be undone. This will permanently delete your account and related data from our servers.`}
        </OverlayDescription>
      </OverlayHeader>
      <div className='flex flex-col gap-4'>
        <div>
          <p className='mb-2 text-sm text-gray-500'>{t`Please type "${EXPECTED_CONFIRMATION_TEXT}"`}</p>
          <Input
            value={confirmationText}
            onChange={(e) => setConfirmationText(e.target.value)}
            placeholder={EXPECTED_CONFIRMATION_TEXT}
            autoCapitalize='none'
            autoCorrect='off'
          />
        </div>
        <div className='flex flex-col gap-2'>
          <Button
            onClick={handleDeleteAccount}
            variant={isConfirmationValid ? 'destructive' : 'secondary'}
            disabled={!isConfirmationValid || isPending}
          >
            {isPending ? t`Sending...` : t`Confirm deletion`}
          </Button>
          <Button variant='outline' onClick={handleCancel} disabled={isPending}>
            {t`Cancel`}
          </Button>
        </div>
      </div>
    </OverlayContent>
  )
}

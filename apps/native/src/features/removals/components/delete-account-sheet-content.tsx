import { useCallback, useMemo, useState } from 'react'
import { Text } from 'react-native'
import { BottomSheetTextInput, BottomSheetView } from '@/components/ui/styled'
import { useRouter } from 'expo-router'
import { useDeleteAccount } from '@/features/removals/api/removals-hooks'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { useBottomSheetPadding } from '@/hooks/use-bottom-sheet-padding'
import { ROUTE_PATHS } from '@/constants/route-paths'
import { useLingui } from '@lingui/react/macro'

const EXPECTED_CONFIRMATION_TEXT = 'I want to delete my account'

interface DeleteAccountSheetContentProps {
  close: () => void
}

export const DeleteAccountSheetContent = ({ close }: DeleteAccountSheetContentProps) => {
  const { t } = useLingui()

  const router = useRouter()
  const clearLocalSession = useAuthStore((state) => state.clearLocalSession)
  const [confirmationText, setConfirmationText] = useState('')

  const isConfirmationValid = useMemo(() => {
    return confirmationText === EXPECTED_CONFIRMATION_TEXT
  }, [confirmationText])

  const deleteAccountMutation = useDeleteAccount({
    onSuccess: async () => {
      close()
      await clearLocalSession()
      router.replace(ROUTE_PATHS.ACCOUNT_REMOVED)
    },
  })

  const handleDeleteAccount = useCallback(() => {
    if (isConfirmationValid) {
      deleteAccountMutation.mutate({ type: 'account' })
    }
  }, [deleteAccountMutation, isConfirmationValid])

  const handleTextChange = useCallback((text: string) => {
    setConfirmationText(text)
  }, [])

  const handleCancel = useCallback(() => {
    setConfirmationText('')
    close()
  }, [close])

  const bottomSheetPadding = useBottomSheetPadding()

  return (
    <BottomSheetView className='px-6 pt-4' style={{ paddingBottom: bottomSheetPadding }}>
      <Text className='mb-2 text-center text-2xl font-semibold'>{t`Are you absolutely sure?`}</Text>
      <Text className='mb-6 text-center text-gray-500'>
        {t`This action cannot be undone. This will permanently delete your account and related data from our servers.`}
      </Text>
      <Text className='mb-3 text-gray-500'>{t`Please type "${EXPECTED_CONFIRMATION_TEXT}"`}</Text>
      <BottomSheetTextInput
        value={confirmationText}
        onChangeText={handleTextChange}
        placeholder={EXPECTED_CONFIRMATION_TEXT}
        className='mb-6 h-16 rounded-lg border border-gray-300 bg-white p-4'
        style={{ minHeight: 50 }}
        autoCapitalize='none'
        autoCorrect={false}
      />
      <Button
        onPress={handleDeleteAccount}
        className='mb-3'
        variant={isConfirmationValid ? 'destructive' : 'inactive'}
        disabled={!isConfirmationValid || deleteAccountMutation.isPending}
        loading={deleteAccountMutation.isPending}
      >
        {deleteAccountMutation.isPending ? t`Sending...` : 'Confirm deletion'}
      </Button>
      <Button variant='outline' onPress={handleCancel} disabled={deleteAccountMutation.isPending}>
        Cancel
      </Button>
    </BottomSheetView>
  )
}

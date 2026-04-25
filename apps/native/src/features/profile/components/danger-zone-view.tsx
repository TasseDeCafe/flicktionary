import { Platform, Text, View } from 'react-native'
import { Stack } from 'expo-router'
import { colors } from '@/constants/colors'
import { BigCard } from '@/components/ui/big-card'
import { BackButton } from '@/components/ui/back-button'
import { useBottomSheetStore } from '@/features/sheets/stores/bottom-sheet-store'
import { SheetId } from '@/features/sheets/components/bottom-sheet-ids'
import { useLingui } from '@lingui/react/macro'
import { SettingsItem } from '@/components/ui/settings-item'

export const DangerZoneView = () => {
  const { t } = useLingui()
  const openSheet = useBottomSheetStore((state) => state.open)

  return (
    <View className='flex-1 bg-red-50'>
      <Stack.Screen
        options={{
          headerShown: true,
          headerShadowVisible: false,
          headerLeft: () => <BackButton />,
          headerTitleAlign: 'center',
          title: 'Danger Zone',
          headerStyle: { backgroundColor: colors.red[50] },
          animation: Platform.OS === 'ios' ? 'slide_from_right' : 'fade',
        }}
      />
      <View className='mt-8 px-4'>
        {/* Warning text section */}
        <View className='mb-6 px-2'>
          <Text className='mb-2 text-lg font-medium text-red-800'>{t`Warning`}</Text>
          <Text className='text-red-600'>{t`Actions in this section can lead to permanent data loss.`}</Text>
        </View>

        {/* Danger Zone options */}
        <BigCard>
          <SettingsItem
            title={t`Delete my account`}
            value=''
            onPress={() => {
              openSheet(SheetId.DELETE_ACCOUNT)
            }}
            variant='destructive'
          />
        </BigCard>
      </View>
    </View>
  )
}

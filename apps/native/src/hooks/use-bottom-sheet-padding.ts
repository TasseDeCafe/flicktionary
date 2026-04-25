import { Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export const useBottomSheetPadding = (): number => {
  const insets = useSafeAreaInsets()
  return Platform.OS === 'ios' ? insets.bottom : insets.bottom + 16
}

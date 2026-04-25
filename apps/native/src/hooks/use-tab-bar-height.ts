import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { TAB_BAR_CONTENT_AREA_HEIGHT, TAB_BAR_PADDING_ABOVE_INSET, TAB_BAR_PADDING_TOP } from '@/constants/tabs-layout'

/**
 * Calculates the total height of the absolutely positioned tab bar,
 * including safe area insets, to be used as paddingBottom for screen content.
 */
export const useTabBarHeight = (): number => {
  const { bottom: bottomInset } = useSafeAreaInsets()

  const calculatedPaddingBottom = bottomInset + TAB_BAR_PADDING_ABOVE_INSET
  const calculatedHeight = TAB_BAR_CONTENT_AREA_HEIGHT + TAB_BAR_PADDING_TOP + calculatedPaddingBottom

  return calculatedHeight
}

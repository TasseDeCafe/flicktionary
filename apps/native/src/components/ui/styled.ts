import { withUniwind } from 'uniwind'
import { SafeAreaView as RNSSafeAreaView } from 'react-native-safe-area-context'
import { ScrollView as RNGHScrollView } from 'react-native-gesture-handler'
import {
  BottomSheetScrollView as GorhomBottomSheetScrollView,
  BottomSheetTextInput as GorhomBottomSheetTextInput,
  BottomSheetView as GorhomBottomSheetView,
} from '@gorhom/bottom-sheet'

export const SafeAreaView = withUniwind(RNSSafeAreaView)
export const ScrollView = withUniwind(RNGHScrollView)
export const BottomSheetScrollView = withUniwind(GorhomBottomSheetScrollView)
export const BottomSheetTextInput = withUniwind(GorhomBottomSheetTextInput)
export const BottomSheetView = withUniwind(GorhomBottomSheetView)

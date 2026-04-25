import { StyleSheet } from 'react-native'

import Animated, { Extrapolation, interpolate, useAnimatedStyle } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { BottomSheetBackdropProps, useBottomSheet } from '@gorhom/bottom-sheet'
import { useMemo } from 'react'

export const BottomSheetBackdrop = ({ animatedIndex, style }: BottomSheetBackdropProps) => {
  const { close } = useBottomSheet()

  const tapHandler = useMemo(
    () =>
      Gesture.Tap().onEnd(() => {
        scheduleOnRN(close)
      }),
    [close]
  )

  const containerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(animatedIndex.value, [-1, 0], [0, 0.5], Extrapolation.CLAMP),
  }))

  const containerStyle = useMemo(
    () => [StyleSheet.absoluteFillObject, { backgroundColor: '#000' }, style, containerAnimatedStyle],
    [style, containerAnimatedStyle]
  )

  return (
    <GestureDetector gesture={tapHandler}>
      <Animated.View style={containerStyle} />
    </GestureDetector>
  )
}

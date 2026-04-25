import React, { ComponentType, FC, memo, useCallback, useMemo } from 'react'
import { BottomSheetBackdropProps, BottomSheetModal } from '@gorhom/bottom-sheet'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { SheetId } from './bottom-sheet-ids'
import { useBottomSheetStore } from '@/features/sheets/stores/bottom-sheet-store'

import { DeleteAccountSheetContent } from '@/features/removals/components/delete-account-sheet-content'
import { ContactUsSheetContent } from '@/features/contact/components/contact-us-sheet-content'
import { BottomSheetBackdrop } from '@/features/sheets/components/bottom-sheet-backdrop'

interface SheetConfig {
  component: ComponentType<any>
  snapPoints?: (string | number)[]
  enableDynamicSizing?: boolean
  enableContentPanningGesture?: boolean
  adjustForKeyboard?: boolean
}

const BOTTOM_SHEET_CONFIG: Record<SheetId, SheetConfig> = {
  [SheetId.DELETE_ACCOUNT]: {
    component: DeleteAccountSheetContent,
  },
  [SheetId.CONTACT_US]: {
    component: ContactUsSheetContent,
    enableContentPanningGesture: false,
  },
}

interface SheetInstanceProps {
  name: SheetId
  config: SheetConfig
  renderBackdrop?: FC<BottomSheetBackdropProps>
}

const SheetInstance = memo(({ name, config, renderBackdrop }: SheetInstanceProps) => {
  const register = useBottomSheetStore((state) => state.register)
  const unregister = useBottomSheetStore((state) => state.unregister)
  const closeSheet = useBottomSheetStore((state) => state.close)
  const snapToIndexSheet = useBottomSheetStore((state) => state.snapToIndex)
  const snapToPositionSheet = useBottomSheetStore((state) => state.snapToPosition)
  const specificProps = useBottomSheetStore(useCallback((state) => state.props.get(name), [name]))
  const insets = useSafeAreaInsets()

  const SheetComponent = config.component

  const refCallback = useCallback(
    (ref: BottomSheetModal | null) => {
      if (ref) {
        register(name, ref)
      } else {
        unregister(name)
      }
    },
    [name, register, unregister]
  )

  const handleDismiss = useCallback(() => {
    closeSheet(name)
  }, [name, closeSheet])

  const modalProps = useMemo(() => {
    const baseProps = {
      name: name.toString(),
      ref: refCallback,
      onDismiss: handleDismiss,
      enablePanDownToClose: true,
      keyboardBehavior: 'interactive' as const,
      keyboardBlurBehavior: 'restore' as const,
      android_keyboardInputMode: 'adjustPan' as const,
      stackBehavior: 'replace' as const,
      enableDynamicSizing: true,
      topInset: insets.top,
    }

    let modalSpecificProps = {}

    if (config.snapPoints) {
      modalSpecificProps = {
        index: 0,
        snapPoints: config.snapPoints,
        enableDynamicSizing: false,
      }
    } else if (config.enableDynamicSizing === false) {
      modalSpecificProps = {
        index: 0,
        snapPoints: ['50%'],
        enableDynamicSizing: false,
      }
    }

    return { ...baseProps, ...modalSpecificProps, backdropComponent: renderBackdrop }
  }, [name, config, refCallback, handleDismiss, renderBackdrop, insets.top])

  const componentProps = useMemo(
    () => ({
      close: () => closeSheet(name),
      snapToIndex: (index: number) => snapToIndexSheet(name, index),
      snapToPosition: (position: string) => snapToPositionSheet(name, position),
      ...(specificProps || {}),
    }),
    [specificProps, name, closeSheet, snapToIndexSheet, snapToPositionSheet]
  )

  if (!SheetComponent) {
    console.error(`[SheetInstance ${name}] SheetComponent is null or undefined!`)
    return null
  }

  return (
    <BottomSheetModal {...modalProps}>
      <SheetComponent {...componentProps} />
    </BottomSheetModal>
  )
})

SheetInstance.displayName = 'SheetInstance'

const BottomSheetControllerComponent = () => {
  return (
    <>
      {Object.keys(BOTTOM_SHEET_CONFIG).map((key) => {
        const name = key as SheetId
        const config = BOTTOM_SHEET_CONFIG[name]

        return <SheetInstance key={name} name={name} config={config} renderBackdrop={BottomSheetBackdrop} />
      })}
    </>
  )
}

export const BottomSheetController = memo(BottomSheetControllerComponent)

BottomSheetController.displayName = 'BottomSheetController'

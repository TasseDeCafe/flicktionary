import { create } from 'zustand'
import * as Haptic from 'expo-haptics'
import { Keyboard } from 'react-native'
import { BottomSheetModal } from '@gorhom/bottom-sheet'

import { SheetId } from '@/features/sheets/components/bottom-sheet-ids'

interface SheetProps {
  [SheetId.DELETE_ACCOUNT]: undefined
  [SheetId.CONTACT_US]: undefined
}

// Interface for the internal state of the store
interface BottomSheetState {
  // Store refs in a Map for efficient lookup (Sheet Name -> Ref)
  refs: Map<SheetId, BottomSheetModal | null>
  // Store props passed during 'open' (Sheet Name -> Props)
  props: Map<SheetId, any>
  // Name of the currently active sheet, if any
  activeSheetName: SheetId | null
}

// Interface for the store's public API (state + actions)
interface BottomSheetStore extends BottomSheetState {
  /** Close a bottom sheet by its name */
  close: (name: SheetId) => void
  /** Register a bottom sheet ref */
  register: (name: SheetId, ref: BottomSheetModal | null) => void
  /** Unregister a bottom sheet ref (e.g., on unmount) */
  unregister: (name: SheetId) => void
  /** Snap a bottom sheet to a specific index */
  snapToIndex: (name: SheetId, index: number) => void
  /** Snap a bottom sheet to a specific position */
  snapToPosition: (name: SheetId, position: string) => void
  /** Open a bottom sheet by its name, optionally passing props */
  open: <T extends SheetId>(name: T, props?: SheetProps[T]) => void
  /** Get the props for a specific sheet */
  getProps: <T extends SheetId>(name: T) => SheetProps[T] | undefined
  /** Update the props for a specific sheet */
  updateProps: <T extends SheetId>(
    name: T,
    updater: (currentProps: SheetProps[T] | undefined) => SheetProps[T] | undefined
  ) => void
}

export const useBottomSheetStore = create<BottomSheetStore>((set, get) => {
  const initialState: BottomSheetState = {
    refs: new Map(),
    props: new Map(),
    activeSheetName: null,
  }

  const open = <T extends SheetId>(name: T, sheetProps?: SheetProps[T]) => {
    const ref = get().refs.get(name)
    if (ref) {
      Keyboard.dismiss()
      Haptic.selectionAsync().then(() => {})
      set((state) => ({
        props: new Map(state.props).set(name, sheetProps),
        activeSheetName: name,
      }))
      ref.present()
    } else {
      console.warn(`[BottomSheetStore] Attempted to open unregistered sheet: ${name}`)
    }
  }

  const close = (name: SheetId) => {
    const ref = get().refs.get(name)
    if (ref) {
      ref.dismiss()
      if (get().activeSheetName === name) {
        set({ activeSheetName: null })
      }
    }
  }

  const snapToIndex = (name: SheetId, index: number) => {
    const ref = get().refs.get(name)
    if (ref) {
      ref.snapToIndex(index)
    }
  }

  const snapToPosition = (name: SheetId, position: string) => {
    const ref = get().refs.get(name)
    if (ref) {
      ref.snapToPosition(position)
    }
  }

  const register = (name: SheetId, ref: BottomSheetModal | null) => {
    set((state) => ({
      refs: new Map(state.refs).set(name, ref),
    }))
  }

  const unregister = (name: SheetId) => {
    set((state) => {
      const newRefs = new Map(state.refs)
      newRefs.delete(name)
      return { refs: newRefs }
    })
  }

  const getProps = <T extends SheetId>(name: T): SheetProps[T] | undefined => {
    return get().props.get(name) as SheetProps[T] | undefined
  }

  const updateProps = <T extends SheetId>(
    name: T,
    updater: (currentProps: SheetProps[T] | undefined) => SheetProps[T] | undefined
  ) => {
    set((state) => {
      const currentProps = state.props.get(name) as SheetProps[T] | undefined
      const nextProps = updater(currentProps)
      const newProps = new Map(state.props)

      if (nextProps === undefined) {
        newProps.delete(name)
      } else {
        newProps.set(name, nextProps)
      }

      return { props: newProps }
    })
  }

  return {
    ...initialState,
    open,
    close,
    snapToIndex,
    snapToPosition,
    register,
    unregister,
    getProps,
    updateProps,
  }
})

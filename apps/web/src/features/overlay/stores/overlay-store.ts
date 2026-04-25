import { create } from 'zustand'
import { USER_FACING_ERROR_CODE } from '@template-app/core/constants/user-facing-error-code'
import { OverlayId } from '@/components/ui/overlay-ids'

type OverlayStore = {
  overlayId: string
  isOpen: boolean
  userFacingErrorCode: USER_FACING_ERROR_CODE
  openOverlay: (overlayId: string) => void
  openErrorOverlay: (errorCode: USER_FACING_ERROR_CODE) => void
  closeOverlay: () => void
}

export const useOverlayStore = create<OverlayStore>((set) => ({
  overlayId: '',
  isOpen: false,
  userFacingErrorCode: USER_FACING_ERROR_CODE.GENERIC_ERROR,

  openOverlay: (overlayId) => {
    set({ isOpen: true, overlayId })
  },

  openErrorOverlay: (errorCode) => {
    set({
      isOpen: true,
      overlayId: OverlayId.SOMETHING_WENT_WRONG,
      userFacingErrorCode: errorCode,
    })
  },

  closeOverlay: () => {
    set({ isOpen: false })
  },
}))

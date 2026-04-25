import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { ALLOWED_REFERRALS } from '@template-app/core/constants/referral-constants'

type TrackingParams = {
  referral: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmTerm: string | null
  utmContent: string | null
}

type TrackingStore = TrackingParams & {
  initializeFromUrl: () => void
  setTracking: (params: Partial<TrackingParams>) => void
  setFromBackend: (params: TrackingParams) => void
}

export const useTrackingStore = create<TrackingStore>()(
  persist(
    (set, get) => ({
      referral: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmTerm: null,
      utmContent: null,

      initializeFromUrl: () => {
        const urlParams = new URLSearchParams(window.location.search)
        const urlPartnerId = urlParams.get('partnerId')
        const urlCreatorId = urlParams.get('c')
        const urlUtmSource = urlParams.get('utm_source')
        const urlUtmMedium = urlParams.get('utm_medium')
        const urlUtmCampaign = urlParams.get('utm_campaign')
        const urlUtmTerm = urlParams.get('utm_term')
        const urlUtmContent = urlParams.get('utm_content')

        const currentState = get()

        // Only set values from URL if they don't already exist in store (persisted from localStorage)
        const referralFromUrl = urlPartnerId || urlCreatorId || null
        const validatedReferral =
          referralFromUrl && ALLOWED_REFERRALS.includes(referralFromUrl) ? referralFromUrl : null

        set({
          referral: currentState.referral || validatedReferral,
          utmSource: currentState.utmSource || urlUtmSource,
          utmMedium: currentState.utmMedium || urlUtmMedium,
          utmCampaign: currentState.utmCampaign || urlUtmCampaign,
          utmTerm: currentState.utmTerm || urlUtmTerm,
          utmContent: currentState.utmContent || urlUtmContent,
        })
      },

      setTracking: (params) => {
        set(params)
      },

      setFromBackend: (params) => {
        // Backend values take precedence, but only set if they have actual values
        set({
          referral: params.referral || get().referral,
          utmSource: params.utmSource || get().utmSource,
          utmMedium: params.utmMedium || get().utmMedium,
          utmCampaign: params.utmCampaign || get().utmCampaign,
          utmTerm: params.utmTerm || get().utmTerm,
          utmContent: params.utmContent || get().utmContent,
        })
      },
    }),
    {
      name: 'tracking-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        referral: state.referral,
        utmSource: state.utmSource,
        utmMedium: state.utmMedium,
        utmCampaign: state.utmCampaign,
        utmTerm: state.utmTerm,
        utmContent: state.utmContent,
      }),
    }
  )
)

export const getHasAllowedReferral = (state: TrackingStore) => {
  return state.referral !== null && ALLOWED_REFERRALS.includes(state.referral)
}

import { LOCAL_STORAGE_CONSTANTS } from '@/lib/storage/local-storage-constants'

export const localStorageWrapper = {
  setReferral: (referral: string): void => {
    if (window) {
      if (referral) {
        window.localStorage.setItem(LOCAL_STORAGE_CONSTANTS.REFERRAL, referral)
      } else {
        window.localStorage.removeItem(LOCAL_STORAGE_CONSTANTS.REFERRAL)
      }
    }
  },
  getReferral: (): string => {
    if (!window) {
      return ''
    }
    const referral: string | null = window.localStorage.getItem(LOCAL_STORAGE_CONSTANTS.REFERRAL)
    return referral || ''
  },
  setUtmSource: (utmSource: string | null) => {
    if (utmSource) {
      localStorage.setItem(LOCAL_STORAGE_CONSTANTS.UTM_SOURCE, utmSource)
    } else {
      localStorage.removeItem(LOCAL_STORAGE_CONSTANTS.UTM_SOURCE)
    }
  },
  getUtmSource: (): string | null => {
    return localStorage.getItem(LOCAL_STORAGE_CONSTANTS.UTM_SOURCE)
  },
  setUtmMedium: (utmMedium: string | null) => {
    if (utmMedium) {
      localStorage.setItem(LOCAL_STORAGE_CONSTANTS.UTM_MEDIUM, utmMedium)
    } else {
      localStorage.removeItem(LOCAL_STORAGE_CONSTANTS.UTM_MEDIUM)
    }
  },
  getUtmMedium: (): string | null => {
    return localStorage.getItem(LOCAL_STORAGE_CONSTANTS.UTM_MEDIUM)
  },
  setUtmCampaign: (utmCampaign: string | null) => {
    if (utmCampaign) {
      localStorage.setItem(LOCAL_STORAGE_CONSTANTS.UTM_CAMPAIGN, utmCampaign)
    } else {
      localStorage.removeItem(LOCAL_STORAGE_CONSTANTS.UTM_CAMPAIGN)
    }
  },
  getUtmCampaign: (): string | null => {
    return localStorage.getItem(LOCAL_STORAGE_CONSTANTS.UTM_CAMPAIGN)
  },
  setUtmTerm: (utmTerm: string | null) => {
    if (utmTerm) {
      localStorage.setItem(LOCAL_STORAGE_CONSTANTS.UTM_TERM, utmTerm)
    } else {
      localStorage.removeItem(LOCAL_STORAGE_CONSTANTS.UTM_TERM)
    }
  },
  getUtmTerm: (): string | null => {
    return localStorage.getItem(LOCAL_STORAGE_CONSTANTS.UTM_TERM)
  },
  setUtmContent: (utmContent: string | null) => {
    if (utmContent) {
      localStorage.setItem(LOCAL_STORAGE_CONSTANTS.UTM_CONTENT, utmContent)
    } else {
      localStorage.removeItem(LOCAL_STORAGE_CONSTANTS.UTM_CONTENT)
    }
  },
  getUtmContent: (): string | null => {
    return localStorage.getItem(LOCAL_STORAGE_CONSTANTS.UTM_CONTENT)
  },
}

import { ALLOWED_REFERRALS } from '@flicktionary/core/constants/referral-constants'
export const processReferral = (referral: string | null | undefined): string | null => {
  if (!referral) {
    return null
  }
  if (ALLOWED_REFERRALS.includes(referral)) {
    return referral
  }
  return null
}

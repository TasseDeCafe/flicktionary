export const OverlayId = {
  SOMETHING_WENT_WRONG: 'something-went-wrong',
  CONTACT_US: 'contact-us',
  RATE_LIMITING: 'rate-limiting',
  PRICING: 'pricing',
  DELETE_ACCOUNT: 'delete-account',
} as const

export type OverlayId = (typeof OverlayId)[keyof typeof OverlayId]

// URL-based overlay IDs (used for route validation in __root.tsx)
// Some overlays should be accessible via URL
export const URL_OVERLAY_IDS = [OverlayId.CONTACT_US] as const

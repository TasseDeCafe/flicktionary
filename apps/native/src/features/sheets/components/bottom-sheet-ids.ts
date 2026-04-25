export const SheetId = {
  DELETE_ACCOUNT: 'delete-account',
  CONTACT_US: 'contact-us',
} as const

export type SheetId = (typeof SheetId)[keyof typeof SheetId]

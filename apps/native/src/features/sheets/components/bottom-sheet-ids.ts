export const SheetId = {
  DELETE_ACCOUNT: 'delete-account',
  CONTACT_US: 'contact-us',
} as const

// eslint-disable-next-line @typescript-eslint/no-redeclare -- intentional const-object + same-named type idiom
export type SheetId = (typeof SheetId)[keyof typeof SheetId]

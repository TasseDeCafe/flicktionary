export const ERROR_CODE_FOR_INVALID_TOKEN = '30'
// Anonymous (guest) JWT rejected because GUEST_MODE_ENABLED is off — the web
// app reacts by clearing the session and landing on /login.
export const ERROR_CODE_FOR_GUEST_ACCESS_DISABLED = 'GUEST_ACCESS_DISABLED'
export const ERROR_CODE_FOR_SUBSCRIPTION_REQUIRED = 'SUBSCRIPTION_REQUIRED'
// An anonymous (guest) user hit the per-guest content-source cap — the web
// app answers with the create-account (save-progress) prompt.
export const ERROR_CODE_FOR_GUEST_SOURCE_LIMIT_REACHED = 'GUEST_SOURCE_LIMIT_REACHED'

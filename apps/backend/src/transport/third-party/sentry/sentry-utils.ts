export const _sanitizeEmails = (str: string): string => {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
  return str.replace(emailRegex, '[EMAIL_REDACTED]')
}

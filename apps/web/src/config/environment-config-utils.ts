export const parseHashedEmails = (hashedEmailsString: string): string[] => {
  return hashedEmailsString
    .split(',')
    .map((email) => email.trim())
    .filter((email) => !!email)
}

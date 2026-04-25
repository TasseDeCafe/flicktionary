import { sha256 } from 'js-sha256'
import { getConfig } from '@/config/environment-config'

const hashEmail = (email: string): string => {
  return sha256(email.toLowerCase().trim())
}

export const checkIsTestUser = (email: string): boolean => {
  const hashedEmail = hashEmail(email)
  return getConfig().hashedEmailsOfTestUsers.includes(hashedEmail)
}

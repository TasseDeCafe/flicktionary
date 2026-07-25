import type { IpaDialects } from '@flicktionary/core/utils/pick-ipa'
import type { TargetIpaDialect } from '../../transport/third-party/anthropic/language-instructions'
import type { UsersRepositoryInterface } from '../../transport/database/users/users-repository'

// Same lenient matching as isEnglishTargetLanguage: stored target languages
// are ISO codes, but tolerate the long forms.
const DIALECT_LANGUAGE_ALIASES: Record<string, keyof IpaDialects> = {
  en: 'en',
  eng: 'en',
  english: 'en',
  es: 'es',
  spa: 'es',
  spanish: 'es',
  pt: 'pt',
  por: 'pt',
  portuguese: 'pt',
}

export const dialectLanguageKey = (targetLanguage: string): keyof IpaDialects | null =>
  DIALECT_LANGUAGE_ALIASES[targetLanguage.trim().toLowerCase()] ?? null

// The user's dialect pick steering LLM output for this target language, or
// undefined for languages without a dialect split (their IPA is untagged).
export const getIpaDialectForTargetLanguage = async (
  usersRepository: Pick<UsersRepositoryInterface, 'getIpaDialects'>,
  userId: string,
  targetLanguage: string
): Promise<TargetIpaDialect | undefined> => {
  const key = dialectLanguageKey(targetLanguage)
  if (!key) return undefined
  const dialects = await usersRepository.getIpaDialects(userId)
  return dialects[key]
}

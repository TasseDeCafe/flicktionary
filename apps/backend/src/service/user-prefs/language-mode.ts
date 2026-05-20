import { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'

type LanguageModeInput = {
  userId: string
  targetLanguage: string
  usersRepository: UsersRepositoryInterface
  targetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface
  snapshotNativeLanguage?: string | null
}

export type LanguageMode = {
  nativeLanguage: string | null
  targetLanguage: string
  sameLanguage: boolean
  showTranslationsEnabled: boolean
  hideTranslationFields: boolean
  allowL1Notes: boolean
}

const normalizeLanguage = (language: string): string => language.trim().toLowerCase()

export const getLanguageMode = async ({
  userId,
  targetLanguage,
  usersRepository,
  targetLanguagePrefsRepository,
  snapshotNativeLanguage = null,
}: LanguageModeInput): Promise<LanguageMode> => {
  const [showTranslationsEnabled, liveNativeLanguage] = await Promise.all([
    targetLanguagePrefsRepository.getShowTranslationsEnabled(userId, targetLanguage),
    usersRepository.getNativeLanguage(userId),
  ])

  const nativeLanguage = liveNativeLanguage ?? snapshotNativeLanguage ?? null
  const sameLanguage =
    nativeLanguage !== null && normalizeLanguage(nativeLanguage) === normalizeLanguage(targetLanguage)
  const hideTranslationFields = sameLanguage || !showTranslationsEnabled

  return {
    nativeLanguage,
    targetLanguage,
    sameLanguage,
    showTranslationsEnabled,
    hideTranslationFields,
    allowL1Notes: nativeLanguage !== null && !sameLanguage,
  }
}

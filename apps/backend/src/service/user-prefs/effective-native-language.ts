import { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'

type EffectiveNativeLanguageInput = {
  userId: string
  targetLanguage: string
  usersRepository: UsersRepositoryInterface
  targetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface
  snapshotNativeLanguage?: string | null
}

export type EffectiveNativeLanguage = {
  nativeLanguage: string | null
  showTranslationsEnabled: boolean
  hideNativeFields: boolean
}

const normalizeLanguage = (language: string): string => language.trim().toLowerCase()

export const getEffectiveNativeLanguage = async ({
  userId,
  targetLanguage,
  usersRepository,
  targetLanguagePrefsRepository,
  snapshotNativeLanguage = null,
}: EffectiveNativeLanguageInput): Promise<EffectiveNativeLanguage> => {
  const [showTranslationsEnabled, liveNativeLanguage] = await Promise.all([
    targetLanguagePrefsRepository.getShowTranslationsEnabled(userId, targetLanguage),
    usersRepository.getNativeLanguage(userId),
  ])

  const nativeLanguage = showTranslationsEnabled ? (liveNativeLanguage ?? snapshotNativeLanguage) : targetLanguage
  const hideNativeFields =
    !showTranslationsEnabled ||
    (nativeLanguage !== null && normalizeLanguage(nativeLanguage) === normalizeLanguage(targetLanguage))

  return {
    nativeLanguage,
    showTranslationsEnabled,
    hideNativeFields,
  }
}

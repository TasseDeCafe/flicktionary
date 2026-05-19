import { UsersRepositoryInterface } from '../../transport/database/users/users-repository'

type EffectiveNativeLanguageInput = {
  userId: string
  targetLanguage: string
  usersRepository: UsersRepositoryInterface
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
  snapshotNativeLanguage = null,
}: EffectiveNativeLanguageInput): Promise<EffectiveNativeLanguage> => {
  const [showTranslationsEnabled, liveNativeLanguage] = await Promise.all([
    usersRepository.getShowTranslationsEnabled(userId),
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

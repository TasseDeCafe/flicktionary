import { z } from 'zod'

// Top 20 most-spoken languages, used for both native and target language pickers.
// `code` is ISO 639-1 (matches `target_language` / `native_language` storage).
export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'zh', name: 'Chinese', nativeName: '中文' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'sw', name: 'Swahili', nativeName: 'Kiswahili' },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी' },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
] as const

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]
export type SupportedLanguageCode = SupportedLanguage['code']

export const SUPPORTED_LANGUAGE_CODES = SUPPORTED_LANGUAGES.map((l) => l.code) as readonly SupportedLanguageCode[]

export const supportedLanguageCodeSchema = z.enum(SUPPORTED_LANGUAGE_CODES)

export const isSupportedLanguageCode = (code: string): code is SupportedLanguageCode =>
  SUPPORTED_LANGUAGES.some((l) => l.code === code)

export const findSupportedLanguage = (code: string): SupportedLanguage | undefined =>
  SUPPORTED_LANGUAGES.find((l) => l.code === code)

export const getLanguageName = (code: string): string => findSupportedLanguage(code)?.name ?? code.toUpperCase()

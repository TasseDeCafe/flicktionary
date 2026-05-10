import { franc } from 'franc-min'
import { isSupportedLanguageCode, type SupportedLanguageCode } from '@flicktionary/core/constants/supported-languages'

// franc-min returns ISO 639-3 codes. Map the ones we support to ISO 639-1
// so they line up with `target_language` storage.
const ISO_639_3_TO_1: Record<string, SupportedLanguageCode> = {
  eng: 'en',
  cmn: 'zh',
  zho: 'zh',
  hin: 'hi',
  spa: 'es',
  arb: 'ar',
  ara: 'ar',
  fra: 'fr',
  ben: 'bn',
  por: 'pt',
  rus: 'ru',
  urd: 'ur',
  ind: 'id',
  deu: 'de',
  jpn: 'ja',
  swh: 'sw',
  mar: 'mr',
  tel: 'te',
  tur: 'tr',
  tam: 'ta',
  vie: 'vi',
  kor: 'ko',
}

// Minimum text length below which franc's signal isn't trustworthy.
// 50 chars is the documented break point in franc's own README.
export const FRANC_MIN_LENGTH = 50

export const detectLanguage = (text: string): SupportedLanguageCode | null => {
  if (text.trim().length < FRANC_MIN_LENGTH) return null
  const iso6393 = franc(text)
  if (iso6393 === 'und') return null
  const iso6391 = ISO_639_3_TO_1[iso6393]
  if (!iso6391) return null
  return isSupportedLanguageCode(iso6391) ? iso6391 : null
}

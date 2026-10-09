import { useLingui } from '@lingui/react/macro'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import type { TestedSkill } from './capture-row-state'

// The sentence a capture row's info sheet opens with: why the row is about
// this card. A search tests production for a native-language query and
// recognition otherwise; a chat proposal tests recognition when the learner's
// message used the word.
export const useTestedBecause = () => {
  const { t } = useLingui()
  return {
    search: (testedSkill: TestedSkill, params: { inputLanguage: string | null; targetLanguage: string }) => {
      const targetLanguage = getLanguageName(params.targetLanguage)
      const searchLanguage = getLanguageName(params.inputLanguage ?? params.targetLanguage)
      return testedSkill === 'meaning_production'
        ? t`You searched in ${searchLanguage}, so this is about coming up with the ${targetLanguage} word: your production card.`
        : t`You searched in ${targetLanguage}, so this is about recognizing the word: your recognition card.`
    },
    chat: (testedSkill: TestedSkill, params: { targetLanguage: string }) => {
      const targetLanguage = getLanguageName(params.targetLanguage)
      return testedSkill === 'meaning_production'
        ? t`You asked for the ${targetLanguage} word, so this is about coming up with it: your production card.`
        : t`Your message used this word, so this is about recognizing it: your recognition card.`
    },
  }
}

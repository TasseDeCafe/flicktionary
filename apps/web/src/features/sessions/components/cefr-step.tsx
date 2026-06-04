import { useLingui } from '@lingui/react/macro'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { OptionCard } from '@flicktionary/ui/components/option-card'
import { WizardStepHeading } from '@/components/ui/wizard-shell'
import { CEFR_LEVELS, type CefrLevel } from '@/features/sessions/constants/cefr'

type Props = {
  targetLanguage: string
  value: CefrLevel | null
  onChange: (level: CefrLevel) => void
}

export const CefrStep = ({ targetLanguage, value, onChange }: Props) => {
  const { t } = useLingui()
  const languageName = getLanguageName(targetLanguage)

  // Lingui needs literal string tags in each branch for extraction. The map
  // covers all six CEFR levels — fall back to an empty string only if a new
  // level ever sneaks in.
  const descriptionFor = (level: CefrLevel): string => {
    switch (level) {
      case 'A1':
        return t`Beginner — basic phrases and immediate needs.`
      case 'A2':
        return t`Elementary — simple, routine exchanges.`
      case 'B1':
        return t`Intermediate — handle most travel and everyday topics.`
      case 'B2':
        return t`Upper intermediate — fluent on familiar topics, some abstract ideas.`
      case 'C1':
        return t`Advanced — flexible, effective use in complex contexts.`
      case 'C2':
        return t`Mastery — virtually everything understood with ease.`
    }
  }

  return (
    <>
      <WizardStepHeading
        title={t`Your level in ${languageName}`}
        subtitle={t`This calibrates the difficult-words pass and the depth of explanations.`}
      />
      <div role='radiogroup' aria-label={t`CEFR level`} className='flex flex-col gap-2'>
        {CEFR_LEVELS.map((level) => (
          <OptionCard
            key={level}
            title={level}
            description={descriptionFor(level)}
            selected={value === level}
            onSelect={() => onChange(level)}
          />
        ))}
      </div>
    </>
  )
}

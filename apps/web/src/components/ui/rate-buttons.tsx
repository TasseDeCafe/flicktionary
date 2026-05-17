import { useLingui } from '@lingui/react/macro'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Button } from '@/components/ui/button'

export type RateValue = 'again' | 'hard' | 'good' | 'easy'

interface RateButtonsProps {
  // Pre-selected rating. Default 'good' so the natural primary tap-target
  // matches the SRS heuristic ("read a chunk, didn't tap = recognized").
  value?: RateValue
  onSelect: (value: RateValue) => void
  disabled?: boolean
  className?: string
}

export const RateButtons = ({ value = 'good', onSelect, disabled, className }: RateButtonsProps) => {
  const { t } = useLingui()

  const buttons: Array<{ key: RateValue; label: string }> = [
    { key: 'again', label: t`Again` },
    { key: 'hard', label: t`Hard` },
    { key: 'good', label: t`Good` },
    { key: 'easy', label: t`Easy` },
  ]

  return (
    <div className={cn('grid grid-cols-4 gap-2', className)}>
      {buttons.map((b) => (
        <Button
          key={b.key}
          type='button'
          size='xl'
          variant={value === b.key ? 'default' : 'outline'}
          disabled={disabled}
          onClick={() => onSelect(b.key)}
        >
          {b.label}
        </Button>
      ))}
    </div>
  )
}

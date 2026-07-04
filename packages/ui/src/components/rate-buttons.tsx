import { useLingui } from '@lingui/react/macro'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Button } from './button'
import { Kbd } from './kbd'

export type RateValue = 'again' | 'hard' | 'good' | 'easy'

// Fixed button order — hosts that bind 1-4 hotkeys map digit N to index N-1 of
// this array, so the on-button badges and the key handling agree by contract.
export const RATE_VALUES: RateValue[] = ['again', 'hard', 'good', 'easy']

interface RateButtonsProps {
  // Pre-selected rating. Default 'good' so the natural primary tap-target
  // matches the SRS heuristic ("read a chunk, didn't tap = recognized").
  value?: RateValue
  onSelect: (value: RateValue) => void
  disabled?: boolean
  // Renders a 1-4 <Kbd> badge on each button. Only for hosts that actually
  // bind those keys (the composed queue on desktop) — keep it off on touch
  // surfaces like the reading-mode RateSheet.
  showKbdHints?: boolean
  className?: string
}

export const RateButtons = ({ value = 'good', onSelect, disabled, showKbdHints, className }: RateButtonsProps) => {
  const { t } = useLingui()

  const labels: Record<RateValue, string> = {
    again: t`Again`,
    hard: t`Hard`,
    good: t`Good`,
    easy: t`Easy`,
  }

  return (
    <div className={cn('grid grid-cols-4 gap-2', className)}>
      {RATE_VALUES.map((key, index) => (
        <Button
          key={key}
          type='button'
          size='xl'
          variant={value === key ? 'default' : 'outline'}
          disabled={disabled}
          onClick={() => onSelect(key)}
        >
          {labels[key]}
          {showKbdHints && <Kbd>{index + 1}</Kbd>}
        </Button>
      ))}
    </div>
  )
}

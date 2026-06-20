import { useState, type ReactNode } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Check } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'

// One pressable skill card. Pure data — the caller owns whether it maps to a
// draft flag (popover) or a live facet (focus view / saved sheet).
export type StudySkillCardItem = {
  key: string
  icon: ReactNode
  label: string
  selected: boolean
  // Hard-locked: the control can't change (e.g. the last enabled skill of a
  // kept term, or the only checked skill in the popover). Rendered as selected
  // but non-interactive.
  disabled?: boolean
  // The skill can't be studied yet (e.g. pronunciation with no IPA). Rendered
  // greyed + non-interactive, with `unavailableHint` surfaced in the tooltip.
  available?: boolean
  unavailableHint?: string
  // Extra hover explanation. Falls back to `unavailableHint` when unavailable.
  tooltip?: ReactNode
  onToggle: () => void
}

type StudySkillCardsProps = {
  cards: StudySkillCardItem[]
  formScope: 'lemma' | 'form'
  surfaceForm: string
  onFormScopeChange: (scope: 'lemma' | 'form') => void
  // The Base/Exact segmented control is locked (e.g. only pronunciation is
  // selected, which never gets a form facet).
  formScopeDisabled?: boolean
  className?: string
}

// Presentational study-target picker shared by the gloss-save popover, the
// reader's saved sheet, the practice lookup sheet, and the extension's in-video
// popovers. Three always-visible monochrome icon-cards (recognition / production
// / pronunciation) plus a "Base form | Exact form" segmented control.
//
// Mono on purpose: every color is a semantic token (foreground / muted /
// border / background), so the same markup reads correct on the web's light
// theme AND inverts cleanly on the extension's hardcoded-dark video overlay.
//
// The hover tooltip is a portal-free absolute child (NOT Radix Tooltip), so it
// stays inside the extension's shadow-DOM overlay. It opens only after pointer
// movement over a card; a newly mounted popover can appear under the stationary
// cursor, and CSS hover would otherwise show a tooltip immediately.
export const StudySkillCards = ({
  cards,
  formScope,
  surfaceForm,
  onFormScopeChange,
  formScopeDisabled,
  className,
}: StudySkillCardsProps) => {
  const [tooltipKey, setTooltipKey] = useState<string | null>(null)

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className='grid grid-cols-3 gap-2'>
        {cards.map((card, index) => {
          const interactive = !card.disabled && card.available !== false
          const tooltip = card.available === false ? (card.unavailableHint ?? card.tooltip) : card.tooltip
          // Anchor the tooltip to the card's near edge instead of centering it,
          // so it never overflows the popover (whose overflow-y-auto would clip
          // it). First card → align left; last → align right; middle → centered.
          const tooltipAlign =
            index === 0 ? 'left-0' : index === cards.length - 1 ? 'right-0' : 'left-1/2 -translate-x-1/2'
          return (
            <button
              key={card.key}
              type='button'
              role='checkbox'
              aria-checked={card.selected}
              aria-label={card.label}
              disabled={!interactive}
              onClick={() => {
                if (interactive) card.onToggle()
              }}
              onPointerMove={() => setTooltipKey(card.key)}
              onPointerLeave={() => {
                setTooltipKey((current) => (current === card.key ? null : current))
              }}
              onBlur={() => {
                setTooltipKey((current) => (current === card.key ? null : current))
              }}
              className={cn(
                'group/skill relative flex flex-col items-center gap-1.5 rounded-lg border px-2 py-2.5 text-center transition-colors',
                'focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none',
                card.available === false
                  ? 'border-border bg-background text-muted-foreground/60 cursor-not-allowed'
                  : card.selected
                    ? 'border-foreground bg-muted text-foreground'
                    : 'border-border bg-background text-foreground/70 hover:border-foreground/40 hover:bg-accent hover:text-foreground',
                card.disabled && card.available !== false && 'cursor-not-allowed'
              )}
            >
              {/* Filled checkmark badge in the corner when selected. */}
              {card.selected && card.available !== false && (
                <span className='bg-foreground text-background absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full'>
                  <Check className='h-2.5 w-2.5' strokeWidth={3} />
                </span>
              )}
              <span className={cn('flex h-5 w-5 items-center justify-center', card.selected && 'text-foreground')}>
                {card.icon}
              </span>
              <span className='text-xs leading-tight font-medium'>{card.label}</span>

              {tooltip && tooltipKey === card.key && (
                <span
                  role='tooltip'
                  className={cn(
                    'bg-foreground text-background pointer-events-none absolute bottom-full z-50 mb-1.5 w-40 rounded-md px-2 py-1 text-center text-xs leading-snug font-normal shadow-md',
                    tooltipAlign
                  )}
                >
                  {tooltip}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <FormScopeControl
        formScope={formScope}
        surfaceForm={surfaceForm}
        onFormScopeChange={onFormScopeChange}
        disabled={formScopeDisabled}
      />
    </div>
  )
}

type FormScopeControlProps = {
  formScope: 'lemma' | 'form'
  surfaceForm: string
  onFormScopeChange: (scope: 'lemma' | 'form') => void
  disabled?: boolean
}

// "Base form | Exact form" segmented control. Base form carries no subtitle;
// Exact form shows the highlighted surface as its subtitle so the user sees
// exactly which inflection a form facet would study.
const FormScopeControl = ({ formScope, surfaceForm, onFormScopeChange, disabled }: FormScopeControlProps) => {
  const { t } = useLingui()
  const options: Array<{ value: 'lemma' | 'form'; label: string; subtitle?: string }> = [
    { value: 'lemma', label: t`Base form` },
    { value: 'form', label: t`Exact form`, subtitle: surfaceForm },
  ]
  return (
    <div className={cn('bg-muted flex gap-1 rounded-lg p-1', disabled && 'opacity-50')}>
      {options.map((option) => {
        const active = formScope === option.value
        return (
          <button
            key={option.value}
            type='button'
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onFormScopeChange(option.value)}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
              'focus-visible:ring-ring/50 focus-visible:ring-[2px] focus-visible:outline-none',
              disabled && 'cursor-not-allowed',
              active ? 'bg-background text-foreground shadow-sm' : 'text-foreground/70 hover:text-foreground'
            )}
          >
            <span>{option.label}</span>
            {option.subtitle && (
              <span
                className={cn('max-w-full truncate', active ? 'text-muted-foreground' : 'text-muted-foreground/70')}
              >
                &ldquo;{option.subtitle}&rdquo;
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

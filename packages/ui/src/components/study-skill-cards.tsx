import { type ReactNode } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Check } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip'

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
// Hints use the shared Radix Tooltip (portals into the extension's in-shadow
// popover container, so it works on the video overlay too). `onFocusCapture` +
// stopPropagation on the grid swallows the focus event the popover fires when it
// autofocuses a card on mount, so the tooltip never self-opens just because the
// popover appeared (radix-ui/primitives#2248). Keyboard focus still works; the
// tooltip simply opens on hover.
export const StudySkillCards = ({
  cards,
  formScope,
  surfaceForm,
  onFormScopeChange,
  formScopeDisabled,
  className,
}: StudySkillCardsProps) => {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <TooltipProvider delayDuration={300}>
        <div className='grid grid-cols-3 gap-2' onFocusCapture={(e) => e.stopPropagation()}>
          {cards.map((card) => (
            <SkillCard key={card.key} card={card} />
          ))}
        </div>
      </TooltipProvider>

      <FormScopeControl
        formScope={formScope}
        surfaceForm={surfaceForm}
        onFormScopeChange={onFormScopeChange}
        disabled={formScopeDisabled}
      />
    </div>
  )
}

const SkillCard = ({ card }: { card: StudySkillCardItem }) => {
  const interactive = !card.disabled && card.available !== false
  const tooltip = card.available === false ? (card.unavailableHint ?? card.tooltip) : card.tooltip

  const button = (
    <button
      type='button'
      role='checkbox'
      aria-checked={card.selected}
      aria-label={card.label}
      disabled={!interactive}
      onClick={() => {
        if (interactive) card.onToggle()
      }}
      className={cn(
        'group/skill relative flex min-h-20 flex-col justify-between rounded-xl border-[1.5px] px-2 py-3 text-center transition-colors',
        'focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none',
        card.available === false
          ? 'border-border bg-background text-muted-foreground/60 cursor-not-allowed'
          : card.selected
            ? 'border-foreground bg-muted text-foreground ring-foreground ring-1'
            : 'border-border bg-background text-foreground hover:border-foreground/40 hover:bg-accent',
        card.disabled && card.available !== false && 'cursor-not-allowed'
      )}
    >
      {/* Top-right selection badge: a filled check when selected, an empty ring
          when not — so every card reads as a multi-select toggle. Hidden only
          when the skill is unavailable. */}
      {card.available !== false &&
        (card.selected ? (
          <span className='bg-foreground text-background absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full'>
            <Check className='h-3 w-3' strokeWidth={3} />
          </span>
        ) : (
          <span
            aria-hidden
            className='border-muted-foreground/30 absolute top-2 right-2 h-5 w-5 rounded-full border-1'
          />
        ))}
      {/* Icon pinned top-left (nudged in slightly); label sits at the bottom
          (justify-between). */}
      <span
        className={cn(
          'ml-1 flex h-5 w-5 items-center justify-center',
          card.available === false ? '' : card.selected ? 'text-foreground' : 'text-muted-foreground'
        )}
      >
        {card.icon}
      </span>
      <span className='text-[11px] leading-tight font-semibold'>{card.label}</span>
    </button>
  )

  if (!tooltip) return button
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side='top' sideOffset={6} className='max-w-44'>
        {tooltip}
      </TooltipContent>
    </Tooltip>
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
    <div className={cn('bg-muted flex gap-1 rounded-xl p-1', disabled && 'opacity-50')}>
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
              'flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors',
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

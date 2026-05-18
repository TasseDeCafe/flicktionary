import type { ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Button } from '@/components/ui/button'
import { ModalScreen } from '@/features/navigation/components/modal-screen'

type WizardAction = {
  label: ReactNode
  onClick: () => void
  disabled?: boolean
  loading?: boolean
}

type WizardShellProps = {
  title?: ReactNode
  // 1-based. Hide the progress bar when totalSteps <= 1.
  currentStep: number
  totalSteps: number
  // X on the first step, chevron-back afterwards.
  onClose: () => void
  onBack?: () => void
  primary?: WizardAction
  secondary?: WizardAction
  rightSlot?: ReactNode
  children: ReactNode
  // Wider column for reading flows. Defaults to max-w-md / md:max-w-lg.
  width?: 'narrow' | 'wide'
}

export const WizardShell = ({
  title,
  currentStep,
  totalSteps,
  onClose,
  onBack,
  primary,
  secondary,
  rightSlot,
  children,
  width = 'narrow',
}: WizardShellProps) => {
  const isFirstStep = currentStep <= 1
  const showProgress = totalSteps > 1
  const progressPct = totalSteps > 0 ? Math.min(100, Math.round((currentStep / totalSteps) * 100)) : 0
  const columnClass = width === 'wide' ? 'max-w-md md:max-w-2xl' : 'max-w-md md:max-w-lg'

  return (
    <ModalScreen
      onClose={isFirstStep ? onClose : (onBack ?? onClose)}
      closeIcon={isFirstStep ? 'x' : 'chevron'}
      title={title}
      rightSlot={rightSlot}
    >
      {showProgress && (
        <div className='shrink-0 border-b bg-white/95 px-4 py-2 backdrop-blur'>
          <div className={cn('mx-auto flex w-full items-center gap-3', columnClass)}>
            <div className='h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200'>
              <div
                className='h-full bg-yellow-500 transition-[width] duration-500 ease-out'
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className='text-muted-foreground text-xs tabular-nums'>
              {currentStep}/{totalSteps}
            </span>
          </div>
        </div>
      )}

      <div className='flex flex-1 flex-col overflow-hidden'>
        <div className='flex-1 overflow-y-auto px-4 pt-6 pb-28'>
          <div className={cn('mx-auto flex w-full flex-col gap-6', columnClass)}>{children}</div>
        </div>

        {(primary || secondary) && (
          <div className='sticky right-0 bottom-0 left-0 z-10 border-t bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur'>
            <div className={cn('mx-auto flex w-full flex-col gap-2', columnClass)}>
              {primary && (
                <Button
                  type='button'
                  size='xl'
                  onClick={primary.onClick}
                  disabled={primary.disabled || primary.loading}
                  className='w-full'
                >
                  {primary.loading ? (
                    <>
                      {primary.label}
                      <LoaderCircle className='ml-1 h-4 w-4 animate-spin' />
                    </>
                  ) : (
                    primary.label
                  )}
                </Button>
              )}
              {secondary && (
                <Button
                  type='button'
                  variant='ghost'
                  size='lg'
                  onClick={secondary.onClick}
                  disabled={secondary.disabled || secondary.loading}
                  className='w-full'
                >
                  {secondary.label}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </ModalScreen>
  )
}

type WizardStepHeadingProps = {
  title: ReactNode
  subtitle?: ReactNode
  className?: string
}

export const WizardStepHeading = ({ title, subtitle, className }: WizardStepHeadingProps) => (
  <div className={cn('flex flex-col gap-2', className)}>
    <h2 className='text-2xl font-semibold tracking-tight'>{title}</h2>
    {subtitle && <p className='text-muted-foreground text-sm'>{subtitle}</p>}
  </div>
)

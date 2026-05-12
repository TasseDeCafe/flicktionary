import { useLingui } from '@lingui/react/macro'
import { Label } from '@/components/ui/label'
import { useSetEnglishIpaDialect } from '@/features/sessions/api/sessions-hooks'

type Dialect = 'ga' | 'rp'

type Props = {
  currentValue: Dialect
  visible: boolean
}

// Hidden entirely when English isn't a target language — the pref doesn't
// influence anything else, so showing it would just be noise.
export const EnglishIpaDialectSelector = ({ currentValue, visible }: Props) => {
  const { t } = useLingui()
  const { mutate, isPending } = useSetEnglishIpaDialect()

  if (!visible) return null

  const choose = (dialect: Dialect) => {
    if (dialect !== currentValue) mutate({ dialect })
  }

  const options: Array<{ value: Dialect; label: string }> = [
    { value: 'ga', label: t`American` },
    { value: 'rp', label: t`British` },
  ]

  return (
    <div className='flex flex-col gap-3'>
      <div>
        <Label className='text-sm font-medium'>{t`English IPA dialect`}</Label>
        <p className='text-muted-foreground mt-1 text-xs'>
          {t`Which pronunciation to show for English vocabulary cards.`}
        </p>
      </div>
      <div className='rounded-md border p-3'>
        <div className='grid grid-cols-2 gap-1 sm:flex sm:items-center'>
          {options.map((opt) => {
            const active = opt.value === currentValue
            return (
              <button
                key={opt.value}
                type='button'
                disabled={isPending}
                onClick={() => choose(opt.value)}
                className={
                  active
                    ? 'rounded-md border border-yellow-400 bg-yellow-100 px-3 py-1 text-xs font-semibold'
                    : 'rounded-md border px-3 py-1 text-xs hover:bg-gray-50 disabled:opacity-50'
                }
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

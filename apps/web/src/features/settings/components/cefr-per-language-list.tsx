import { useLingui } from '@lingui/react/macro'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { Label } from '@/components/ui/label'
import { useSetCefrForLanguage } from '@/features/sessions/api/sessions-hooks'

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const
type CefrLevel = (typeof LEVELS)[number]

type Pref = {
  targetLanguage: string
  cefrLevel: string
}

type Props = {
  prefs: Pref[]
}

const isCefrLevel = (v: string): v is CefrLevel => (LEVELS as readonly string[]).includes(v)

export const CefrPerLanguageList = ({ prefs }: Props) => {
  const { t } = useLingui()
  const { mutate, isPending, variables } = useSetCefrForLanguage()

  const handleChange = (targetLanguage: string, level: CefrLevel) => {
    mutate({ targetLanguage, cefrLevel: level })
  }

  if (prefs.length === 0) {
    return (
      <div>
        <Label className='text-sm font-medium'>{t`CEFR level per language`}</Label>
        <p className='text-muted-foreground mt-2 text-xs'>
          {t`No target languages yet. Levels are set the first time you start a session in a new language.`}
        </p>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-3'>
      <div>
        <Label className='text-sm font-medium'>{t`CEFR level per language`}</Label>
        <p className='text-muted-foreground mt-1 text-xs'>
          {t`Calibrates the difficult-words pass and the depth of explanations.`}
        </p>
      </div>
      <ul className='flex flex-col gap-2'>
        {prefs.map((p) => {
          const isRowPending = isPending && variables?.targetLanguage === p.targetLanguage
          return (
            <li
              key={p.targetLanguage}
              className='flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between'
            >
              <span className='font-medium'>{getLanguageName(p.targetLanguage)}</span>
              <div className='grid w-full grid-cols-6 gap-1 sm:flex sm:w-auto sm:items-center'>
                {LEVELS.map((lvl) => {
                  const active = lvl === p.cefrLevel
                  return (
                    <button
                      key={lvl}
                      type='button'
                      disabled={isRowPending}
                      onClick={() => {
                        if (lvl !== p.cefrLevel && isCefrLevel(lvl)) handleChange(p.targetLanguage, lvl)
                      }}
                      className={
                        active
                          ? 'rounded-md border border-yellow-400 bg-yellow-100 px-3 py-1 text-xs font-semibold'
                          : 'rounded-md border px-3 py-1 text-xs hover:bg-gray-50 disabled:opacity-50'
                      }
                    >
                      {lvl}
                    </button>
                  )
                })}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

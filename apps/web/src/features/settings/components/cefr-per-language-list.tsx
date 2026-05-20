import { useLingui } from '@lingui/react/macro'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useSetCefrForLanguage, useSetShowTranslationsForLanguage } from '@/features/sessions/api/sessions-hooks'

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const
type CefrLevel = (typeof LEVELS)[number]

type Pref = {
  targetLanguage: string
  cefrLevel: string
  showTranslationsEnabled: boolean
}

type Props = {
  prefs: Pref[]
}

const isCefrLevel = (v: string): v is CefrLevel => (LEVELS as readonly string[]).includes(v)

export const CefrPerLanguageList = ({ prefs }: Props) => {
  const { t } = useLingui()
  const { mutate, isPending, variables } = useSetCefrForLanguage()
  const {
    mutate: setShowTranslations,
    isPending: isSavingShowTranslations,
    variables: showTranslationsVariables,
  } = useSetShowTranslationsForLanguage()

  const handleChange = (targetLanguage: string, level: CefrLevel) => {
    mutate({ targetLanguage, cefrLevel: level })
  }

  if (prefs.length === 0) {
    return (
      <div>
        <Label className='text-sm font-medium'>{t`Language preferences`}</Label>
        <p className='text-muted-foreground mt-2 text-xs'>
          {t`No target languages yet. Preferences are set the first time you start a session in a new language.`}
        </p>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-3'>
      <div>
        <Label className='text-sm font-medium'>{t`Language preferences`}</Label>
        <p className='text-muted-foreground mt-1 text-xs'>
          {t`Set your CEFR level and translation behavior for each target language.`}
        </p>
      </div>
      <ul className='flex flex-col gap-2'>
        {prefs.map((p) => {
          const isRowPending = isPending && variables?.targetLanguage === p.targetLanguage
          const isShowTranslationsPending =
            isSavingShowTranslations && showTranslationsVariables?.targetLanguage === p.targetLanguage
          return (
            <li key={p.targetLanguage} className='flex flex-col gap-3 rounded-md border p-3'>
              <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
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
              </div>
              <div className='flex items-center justify-between gap-3 border-t pt-3'>
                <div className='flex flex-col gap-1'>
                  <span className='text-sm font-medium'>{t`Show translations`}</span>
                  <p className='text-muted-foreground text-xs'>
                    {t`Show existing translations and generate translations for new cards in this language.`}
                  </p>
                </div>
                <Switch
                  checked={p.showTranslationsEnabled}
                  disabled={isShowTranslationsPending}
                  onCheckedChange={(checked) =>
                    setShowTranslations({ targetLanguage: p.targetLanguage, enabled: checked })
                  }
                  aria-label={t`Show translations`}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

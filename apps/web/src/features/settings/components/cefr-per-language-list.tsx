import { useLingui } from '@lingui/react/macro'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { Label } from '@flicktionary/ui/components/label'
import { Switch } from '@flicktionary/ui/components/switch'
import {
  useSetCefrForLanguage,
  useSetEnglishIpaDialect,
  useSetShowTranslationsForLanguage,
} from '@/features/sessions/api/sessions-hooks'

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const
type CefrLevel = (typeof LEVELS)[number]

type IpaDialect = 'ga' | 'rp'

type Pref = {
  targetLanguage: string
  cefrLevel: string
  showTranslationsEnabled: boolean
}

type Props = {
  prefs: Pref[]
  englishIpaDialect: IpaDialect
}

const isCefrLevel = (v: string): v is CefrLevel => (LEVELS as readonly string[]).includes(v)

export const CefrPerLanguageList = ({ prefs, englishIpaDialect }: Props) => {
  const { t } = useLingui()
  const { mutate, isPending, variables } = useSetCefrForLanguage()
  const {
    mutate: setShowTranslations,
    isPending: isSavingShowTranslations,
    variables: showTranslationsVariables,
  } = useSetShowTranslationsForLanguage()
  const { mutate: setEnglishIpaDialect, isPending: isSavingIpaDialect } = useSetEnglishIpaDialect()

  const ipaOptions: Array<{ value: IpaDialect; label: string }> = [
    { value: 'ga', label: t`American` },
    { value: 'rp', label: t`British` },
  ]

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
                            ? 'rounded-md border border-yellow-400 bg-yellow-100 px-3 py-1 text-xs font-semibold dark:bg-yellow-400/15'
                            : 'rounded-md border px-3 py-1 text-xs transition-colors hover:bg-accent active:bg-accent disabled:opacity-50'
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
              {p.targetLanguage === 'en' && (
                <div className='flex items-center justify-between gap-3 border-t pt-3'>
                  <div className='flex flex-col gap-1'>
                    <span className='text-sm font-medium'>{t`IPA dialect`}</span>
                    <p className='text-muted-foreground text-xs'>
                      {t`Which pronunciation to show for English vocabulary cards.`}
                    </p>
                  </div>
                  <div className='flex shrink-0 items-center gap-1'>
                    {ipaOptions.map((opt) => {
                      const active = opt.value === englishIpaDialect
                      return (
                        <button
                          key={opt.value}
                          type='button'
                          disabled={isSavingIpaDialect}
                          onClick={() => {
                            if (opt.value !== englishIpaDialect) setEnglishIpaDialect({ dialect: opt.value })
                          }}
                          className={
                            active
                              ? 'rounded-md border border-yellow-400 bg-yellow-100 px-3 py-1 text-xs font-semibold dark:bg-yellow-400/15'
                              : 'rounded-md border px-3 py-1 text-xs transition-colors hover:bg-accent active:bg-accent disabled:opacity-50'
                          }
                        >
                          {opt.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

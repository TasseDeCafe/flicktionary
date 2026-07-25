import { useEffect, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { Input } from '@flicktionary/ui/components/input'
import { Label } from '@flicktionary/ui/components/label'
import { Switch } from '@flicktionary/ui/components/switch'
import type { IpaDialects } from '@flicktionary/core/utils/pick-ipa'
import {
  useSetCefrForLanguage,
  useSetIpaDialect,
  useSetPracticeLimitsForLanguage,
  useSetShowTranslationsForLanguage,
} from '@/features/sessions/api/sessions-hooks'
import {
  PRACTICE_MAX_NEW_TERMS_LIMIT,
  PRACTICE_MAX_REVIEW_TERMS_LIMIT,
  type IpaDialectInput,
} from '@flicktionary/api-client/orpc-contracts/user-prefs-contract'

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const
type CefrLevel = (typeof LEVELS)[number]

type Pref = {
  targetLanguage: string
  cefrLevel: string
  showTranslationsEnabled: boolean
  practiceMaxNewTerms: number
  practiceMaxReviewTerms: number
  practiceMaxReviewTermsProduction: number | null
}

const clampLimit = (value: number, max: number) => Math.min(Math.max(Math.trunc(value), 0), max)

// Module-scope on purpose: each language card owns its own draft state, and an
// inline component would remount (and drop drafts) on every list render.
const PracticeLimitsRow = ({
  targetLanguage,
  maxNewTerms,
  maxReviewTerms,
  maxReviewTermsProduction,
}: {
  targetLanguage: string
  maxNewTerms: number
  maxReviewTerms: number
  maxReviewTermsProduction: number | null
}) => {
  const { t } = useLingui()
  const { mutate, isPending, variables } = useSetPracticeLimitsForLanguage()
  const isRowPending = isPending && variables?.targetLanguage === targetLanguage
  const [draftNew, setDraftNew] = useState(String(maxNewTerms))
  const [draftReview, setDraftReview] = useState(String(maxReviewTerms))
  // Nullable production cap: empty string means uncapped (null).
  const [draftProductionReview, setDraftProductionReview] = useState(
    maxReviewTermsProduction == null ? '' : String(maxReviewTermsProduction)
  )

  useEffect(() => {
    /* eslint-disable react-you-might-not-need-an-effect/no-adjust-state-on-prop-change, react-you-might-not-need-an-effect/no-derived-state -- the inputs are editable DRAFTS re-seeded when the server row changes (own save round-trip, another device); deriving during render would make the server value win over in-progress typing */
    setDraftNew(String(maxNewTerms))
    setDraftReview(String(maxReviewTerms))
    setDraftProductionReview(maxReviewTermsProduction == null ? '' : String(maxReviewTermsProduction))
    /* eslint-enable react-you-might-not-need-an-effect/no-adjust-state-on-prop-change, react-you-might-not-need-an-effect/no-derived-state */
  }, [maxNewTerms, maxReviewTerms, maxReviewTermsProduction])

  const save = () => {
    const parsedNew = Number.parseInt(draftNew, 10)
    const parsedReview = Number.parseInt(draftReview, 10)
    const nextNew = clampLimit(Number.isFinite(parsedNew) ? parsedNew : maxNewTerms, PRACTICE_MAX_NEW_TERMS_LIMIT)
    const nextReview = clampLimit(
      Number.isFinite(parsedReview) ? parsedReview : maxReviewTerms,
      PRACTICE_MAX_REVIEW_TERMS_LIMIT
    )
    // Recognition pair keeps the "at least one > 0" guard; an all-zero edit is
    // ignored and reverted to the saved values.
    const recognition =
      nextNew + nextReview > 0
        ? { maxNewTerms: nextNew, maxReviewTerms: nextReview }
        : { maxNewTerms: maxNewTerms, maxReviewTerms: maxReviewTerms }

    // Production review cap is independent and nullable: empty (or non-numeric)
    // means uncapped (null); a number is clamped like the others.
    const trimmedProduction = draftProductionReview.trim()
    const parsedProduction = Number.parseInt(trimmedProduction, 10)
    const nextProductionReview: number | null =
      trimmedProduction === '' || !Number.isFinite(parsedProduction)
        ? null
        : clampLimit(parsedProduction, PRACTICE_MAX_REVIEW_TERMS_LIMIT)

    setDraftNew(String(recognition.maxNewTerms))
    setDraftReview(String(recognition.maxReviewTerms))
    setDraftProductionReview(nextProductionReview == null ? '' : String(nextProductionReview))

    const unchanged =
      recognition.maxNewTerms === maxNewTerms &&
      recognition.maxReviewTerms === maxReviewTerms &&
      nextProductionReview === maxReviewTermsProduction
    if (unchanged) return
    mutate({ targetLanguage, ...recognition, maxReviewTermsProduction: nextProductionReview })
  }

  return (
    <div className='flex flex-col gap-3 border-t pt-3'>
      <div className='flex flex-col gap-1'>
        <span className='text-sm font-medium'>{t`Practice limits`}</span>
        <p className='text-muted-foreground text-xs'>
          {t`Introductions are capped per day. Follow-up sessions use up to this many review terms.`}
        </p>
      </div>

      {/* Language-level: recognition and production introductions share ONE
          combined daily budget (a term studied in both pools consumes two
          slots), so the input sits outside the per-pool groups. */}
      <div className='grid grid-cols-2 gap-3'>
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor={`practice-max-new-terms-${targetLanguage}`} className='text-muted-foreground text-xs'>
            {t`New introductions per day`}
          </Label>
          <Input
            id={`practice-max-new-terms-${targetLanguage}`}
            type='number'
            inputMode='numeric'
            min={0}
            max={PRACTICE_MAX_NEW_TERMS_LIMIT}
            value={draftNew}
            disabled={isRowPending}
            onChange={(event) => setDraftNew(event.target.value)}
            onBlur={save}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
          />
          <p className='text-muted-foreground text-xs'>{t`Covers recognition and production combined.`}</p>
        </div>
      </div>

      <div className='flex flex-col gap-1.5'>
        <span className='text-muted-foreground text-xs font-semibold tracking-wide uppercase'>{t`Recognition`}</span>
        <div className='grid grid-cols-2 gap-3'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor={`practice-max-review-terms-${targetLanguage}`} className='text-muted-foreground text-xs'>
              {t`Review terms`}
            </Label>
            <Input
              id={`practice-max-review-terms-${targetLanguage}`}
              type='number'
              inputMode='numeric'
              min={0}
              max={PRACTICE_MAX_REVIEW_TERMS_LIMIT}
              value={draftReview}
              disabled={isRowPending}
              onChange={(event) => setDraftReview(event.target.value)}
              onBlur={save}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
              }}
            />
          </div>
        </div>
      </div>

      <div className='flex flex-col gap-1.5'>
        <span className='text-muted-foreground text-xs font-semibold tracking-wide uppercase'>{t`Production`}</span>
        <div className='grid grid-cols-2 gap-3'>
          <div className='flex flex-col gap-1.5'>
            <Label
              htmlFor={`practice-max-review-terms-production-${targetLanguage}`}
              className='text-muted-foreground text-xs'
            >
              {t`Review terms`}
            </Label>
            <Input
              id={`practice-max-review-terms-production-${targetLanguage}`}
              type='number'
              inputMode='numeric'
              min={0}
              max={PRACTICE_MAX_REVIEW_TERMS_LIMIT}
              value={draftProductionReview}
              disabled={isRowPending}
              onChange={(event) => setDraftProductionReview(event.target.value)}
              onBlur={save}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
              }}
            />
            <p className='text-muted-foreground text-xs'>{t`Leave empty for no limit.`}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

type Props = {
  prefs: Pref[]
  ipaDialects: IpaDialects
}

const isCefrLevel = (v: string): v is CefrLevel => (LEVELS as readonly string[]).includes(v)

export const CefrPerLanguageList = ({ prefs, ipaDialects }: Props) => {
  const { t } = useLingui()
  const { mutate, isPending, variables } = useSetCefrForLanguage()
  const {
    mutate: setShowTranslations,
    isPending: isSavingShowTranslations,
    variables: showTranslationsVariables,
  } = useSetShowTranslationsForLanguage()
  const { mutate: setIpaDialect, isPending: isSavingIpaDialect } = useSetIpaDialect()

  // Per-language IPA dialect toggles. Each option carries the full mutation
  // input so the discriminated union ties the dialect values to the language.
  const ipaDialectRowFor = (
    targetLanguage: string
  ): { description: string; options: Array<{ input: IpaDialectInput; label: string }> } | null => {
    if (targetLanguage === 'en')
      return {
        description: t`Which pronunciation to show for English vocabulary cards.`,
        options: [
          { input: { targetLanguage: 'en', dialect: 'ga' }, label: t`American` },
          { input: { targetLanguage: 'en', dialect: 'rp' }, label: t`British` },
        ],
      }
    if (targetLanguage === 'es')
      return {
        description: t`Which pronunciation to show for Spanish vocabulary cards.`,
        options: [
          { input: { targetLanguage: 'es', dialect: 'lam' }, label: t`Latin American` },
          { input: { targetLanguage: 'es', dialect: 'cas' }, label: t`European` },
        ],
      }
    if (targetLanguage === 'pt')
      return {
        description: t`Which pronunciation to show for Portuguese vocabulary cards.`,
        options: [
          { input: { targetLanguage: 'pt', dialect: 'br' }, label: t`Brazilian` },
          { input: { targetLanguage: 'pt', dialect: 'eu' }, label: t`European` },
        ],
      }
    return null
  }

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
          {t`Set your CEFR level, translation behavior and daily practice limits for each target language.`}
        </p>
      </div>
      <ul className='flex flex-col gap-2'>
        {prefs.map((p) => {
          const isRowPending = isPending && variables?.targetLanguage === p.targetLanguage
          const isShowTranslationsPending =
            isSavingShowTranslations && showTranslationsVariables?.targetLanguage === p.targetLanguage
          const dialectRow = ipaDialectRowFor(p.targetLanguage)
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
                            : 'hover:bg-accent active:bg-accent rounded-md border px-3 py-1 text-xs transition-colors disabled:opacity-50'
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
                  <span className='text-sm font-medium'>{t`Generate translations`}</span>
                  <p className='text-muted-foreground text-xs'>
                    {t`Generate translations for new cards in this language. You can always add a translation to a card manually.`}
                  </p>
                </div>
                <Switch
                  checked={p.showTranslationsEnabled}
                  disabled={isShowTranslationsPending}
                  onCheckedChange={(checked) =>
                    setShowTranslations({ targetLanguage: p.targetLanguage, enabled: checked })
                  }
                  aria-label={t`Generate translations`}
                />
              </div>
              <PracticeLimitsRow
                targetLanguage={p.targetLanguage}
                maxNewTerms={p.practiceMaxNewTerms}
                maxReviewTerms={p.practiceMaxReviewTerms}
                maxReviewTermsProduction={p.practiceMaxReviewTermsProduction}
              />
              {dialectRow && (
                <div className='flex items-center justify-between gap-3 border-t pt-3'>
                  <div className='flex flex-col gap-1'>
                    <span className='text-sm font-medium'>{t`IPA dialect`}</span>
                    <p className='text-muted-foreground text-xs'>{dialectRow.description}</p>
                  </div>
                  <div className='flex shrink-0 items-center gap-1'>
                    {dialectRow.options.map((opt) => {
                      const active = ipaDialects[opt.input.targetLanguage] === opt.input.dialect
                      return (
                        <button
                          key={opt.input.dialect}
                          type='button'
                          disabled={isSavingIpaDialect}
                          onClick={() => {
                            if (!active) setIpaDialect(opt.input)
                          }}
                          className={
                            active
                              ? 'rounded-md border border-yellow-400 bg-yellow-100 px-3 py-1 text-xs font-semibold dark:bg-yellow-400/15'
                              : 'hover:bg-accent active:bg-accent rounded-md border px-3 py-1 text-xs transition-colors disabled:opacity-50'
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

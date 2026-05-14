import { useEffect, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { useSetPracticeSessionLimits } from '@/features/sessions/api/sessions-hooks'
import {
  PRACTICE_MAX_NEW_TERMS_LIMIT,
  PRACTICE_MAX_REVIEW_TERMS_LIMIT,
} from '@flicktionary/api-client/orpc-contracts/user-prefs-contract'

type Props = {
  maxNewTerms: number
  maxReviewTerms: number
}

const clamp = (value: number, max: number) => Math.min(Math.max(Math.trunc(value), 0), max)

export const PracticeSessionLimitsSetting = ({ maxNewTerms, maxReviewTerms }: Props) => {
  const { t } = useLingui()
  const { mutate, isPending } = useSetPracticeSessionLimits()
  const [draftNew, setDraftNew] = useState(String(maxNewTerms))
  const [draftReview, setDraftReview] = useState(String(maxReviewTerms))

  useEffect(() => {
    setDraftNew(String(maxNewTerms))
    setDraftReview(String(maxReviewTerms))
  }, [maxNewTerms, maxReviewTerms])

  const save = () => {
    const parsedNew = Number.parseInt(draftNew, 10)
    const parsedReview = Number.parseInt(draftReview, 10)
    const nextNew = clamp(Number.isFinite(parsedNew) ? parsedNew : maxNewTerms, PRACTICE_MAX_NEW_TERMS_LIMIT)
    const nextReview = clamp(
      Number.isFinite(parsedReview) ? parsedReview : maxReviewTerms,
      PRACTICE_MAX_REVIEW_TERMS_LIMIT
    )
    const payload =
      nextNew + nextReview > 0
        ? { maxNewTerms: nextNew, maxReviewTerms: nextReview }
        : { maxNewTerms: maxNewTerms, maxReviewTerms: maxReviewTerms }

    setDraftNew(String(payload.maxNewTerms))
    setDraftReview(String(payload.maxReviewTerms))
    if (payload.maxNewTerms === maxNewTerms && payload.maxReviewTerms === maxReviewTerms) return
    mutate(payload)
  }

  return (
    <div className='flex flex-col gap-3 px-4 py-3'>
      <div className='flex flex-col gap-1'>
        <span className='text-sm font-medium'>{t`Practice limits`}</span>
        <p className='text-muted-foreground text-xs'>
          {t`New terms are capped per day. Follow-up sessions use up to this many review terms.`}
        </p>
      </div>
      <div className='grid grid-cols-2 gap-3'>
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='practice-max-new-terms' className='text-muted-foreground text-xs'>
            {t`New terms`}
          </Label>
          <Input
            id='practice-max-new-terms'
            type='number'
            inputMode='numeric'
            min={0}
            max={PRACTICE_MAX_NEW_TERMS_LIMIT}
            value={draftNew}
            disabled={isPending}
            onChange={(event) => setDraftNew(event.target.value)}
            onBlur={save}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
          />
        </div>
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='practice-max-review-terms' className='text-muted-foreground text-xs'>
            {t`Review terms`}
          </Label>
          <Input
            id='practice-max-review-terms'
            type='number'
            inputMode='numeric'
            min={0}
            max={PRACTICE_MAX_REVIEW_TERMS_LIMIT}
            value={draftReview}
            disabled={isPending}
            onChange={(event) => setDraftReview(event.target.value)}
            onBlur={save}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
          />
        </div>
      </div>
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import type { StrengthenExerciseEntry } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { useContinueWarmupSession } from '../api/practice-hooks'
import { ExerciseSessionView } from './exercise-session-view'

// Language-scoped warm-up continuation, launched from the Practice tab's
// "N terms warming up — continue" affordance. Unlike the session-scoped warm-up
// (which parks new terms), this serves every term in the language that is
// already onboarding-parked. The continue endpoint is serve-only, so the same
// call powers both the initial load and the placeholder poll.
export const WarmupContinueView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { targetLanguage } = useParams({ from: '/_authenticated/_app/practice/warmup-continue/$targetLanguage' })
  const languageName = getLanguageName(targetLanguage)

  const { mutate: startSession, mutateAsync: continueAsync, isPending, isError } = useContinueWarmupSession()
  const [entries, setEntries] = useState<StrengthenExerciseEntry[] | null>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    startSession({ targetLanguage }, { onSuccess: (resp) => setEntries(resp.data.exercises) })
  }, [startSession, targetLanguage])

  const pollExercises = useCallback(async () => {
    const resp = await continueAsync({ targetLanguage })
    return resp.data.exercises
  }, [continueAsync, targetLanguage])

  const close = () => void navigate({ to: '/practice/language/$targetLanguage', params: { targetLanguage } })

  return (
    <ExerciseSessionView
      title={t`Warm up your terms · ${languageName}`}
      copyVariant='warmup'
      entries={entries}
      isPending={isPending}
      isError={isError}
      backLabel={t`Back to ${languageName}`}
      pollExercises={pollExercises}
      onClose={close}
    />
  )
}

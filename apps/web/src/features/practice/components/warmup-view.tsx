import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import type { StrengthenExerciseEntry } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { useStartWarmupSession, useRefreshWarmupSession } from '../api/practice-hooks'
import { ExerciseSessionView } from './exercise-session-view'

// Exercise-first warm-up: launched from the session-vocabulary footer. Parks
// this session's new terms into scaffolding and serves gate exercises; correct
// answers graduate them into the flashcard queue. Thin wrapper around the
// shared ExerciseSessionView with the onboarding copy variant.
export const WarmupView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { targetLanguage } = useParams({ from: '/_authenticated/_app/practice/warmup/$targetLanguage' })
  const { studySessionId } = useSearch({ from: '/_authenticated/_app/practice/warmup/$targetLanguage' })
  const languageName = getLanguageName(targetLanguage)

  const { mutate: startSession, isError } = useStartWarmupSession()
  const { mutateAsync: refreshSession } = useRefreshWarmupSession()
  const [entries, setEntries] = useState<StrengthenExerciseEntry[] | null>(null)
  const [dailyLimitReached, setDailyLimitReached] = useState(false)
  const startedRef = useRef(false)

  // Serve-only poll for the shared session view to swap 'generating'
  // placeholders in place as the background bank settles.
  const pollExercises = useCallback(async () => {
    const resp = await refreshSession({ studySessionId, targetLanguage })
    return resp.data.exercises
  }, [refreshSession, studySessionId, targetLanguage])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    startSession(
      { studySessionId, targetLanguage },
      {
        onSuccess: (resp) => {
          setEntries(resp.data.exercises)
          setDailyLimitReached(resp.data.dailyLimitReached)
        },
      }
    )
  }, [startSession, studySessionId, targetLanguage])

  const close = () => void navigate({ to: '/practice/language/$targetLanguage', params: { targetLanguage } })

  return (
    <ExerciseSessionView
      title={t`Warm up your terms · ${languageName}`}
      copyVariant='warmup'
      entries={entries}
      isError={isError}
      dailyLimitReached={dailyLimitReached}
      backLabel={t`Back to ${languageName}`}
      pollExercises={pollExercises}
      onClose={close}
      targetLanguage={targetLanguage}
      practiceMode='warmup'
      practiceStudySessionId={studySessionId}
    />
  )
}

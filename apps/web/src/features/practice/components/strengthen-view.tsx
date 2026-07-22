import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import {
  DEFAULT_PRACTICE_QUEUE_FILTER,
  type StrengthenExerciseEntry,
} from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { useStartStrengthenSession } from '../api/practice-hooks'
import { ExerciseSessionView } from './exercise-session-view'
import { exerciseSessionKey, takeExerciseSession } from './exercise-session-snapshot'
import { splitMixChain } from '../utils/daily-mix'

// Strengthen session: leech-rehab gate exercises + this-session again/hard
// bonus exercises. Thin wrapper around the shared ExerciseSessionView — it owns
// only the fetch (start hook) and the rehab copy variant.
export const StrengthenView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { targetLanguage } = useParams({ from: '/_authenticated/_app/practice/strengthen/$targetLanguage' })
  const { pool, sessionHard, mix } = useSearch({ from: '/_authenticated/_app/practice/strengthen/$targetLanguage' })
  const languageName = getLanguageName(targetLanguage)

  // An interrupted same-scope session (edit-term detour, back gesture) resumes
  // from its stashed snapshot instead of starting fresh — a restart would
  // recompose the gate queue and re-serve every remaining exercise.
  const sessionKey = exerciseSessionKey({ mode: 'strengthen', targetLanguage, pool, sessionHard, mix })
  const [resumedSession] = useState(() => takeExerciseSession(sessionKey))
  const { mutate: startSession, isError } = useStartStrengthenSession()
  const [entries, setEntries] = useState<StrengthenExerciseEntry[] | null>(resumedSession?.queue ?? null)
  const startedRef = useRef(resumedSession != null)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    startSession(
      { targetLanguage, pool, sessionHardUserLookupIds: sessionHard ?? [] },
      { onSuccess: (resp) => setEntries(resp.data.exercises) }
    )
  }, [startSession, targetLanguage, pool, sessionHard])

  // Mid-mix, closing continues the chain to the next language (the composed
  // route's default filter — a mix always runs the everyday queue). A
  // strengthen launched from the mix-final completion screen ends the mix, so
  // it exits to the dashboard like every other mix exit; otherwise back to the
  // language landing as usual.
  const mixChain = splitMixChain(mix, targetLanguage)
  const mixUpcoming = mixChain?.upcoming ?? []
  const close = () => {
    if (mixUpcoming.length > 0) {
      void navigate({
        to: '/practice/composed/$targetLanguage',
        params: { targetLanguage: mixUpcoming[0] },
        search: { ...DEFAULT_PRACTICE_QUEUE_FILTER, mix },
      })
      return
    }
    if (mixChain) {
      void navigate({ to: '/dashboard' })
      return
    }
    void navigate({ to: '/practice/language/$targetLanguage', params: { targetLanguage } })
  }

  // The completion CTA must say where close actually goes.
  const nextLanguageName = mixUpcoming.length > 0 ? getLanguageName(mixUpcoming[0]) : null
  const backLabel = nextLanguageName
    ? t`Continue with ${nextLanguageName}`
    : mixChain
      ? t`Finish`
      : t`Back to ${languageName}`

  return (
    <ExerciseSessionView
      title={t`Strengthen · ${languageName}`}
      copyVariant='rehab'
      entries={entries}
      isError={isError}
      backLabel={backLabel}
      onClose={close}
      targetLanguage={targetLanguage}
      practiceMode='strengthen'
      practiceSessionHard={sessionHard}
      practiceMix={mix}
      sessionPool={pool}
      sessionKey={sessionKey}
      resumedSession={resumedSession}
    />
  )
}

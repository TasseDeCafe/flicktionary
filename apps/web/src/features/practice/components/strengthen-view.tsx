import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import type { StrengthenExerciseEntry } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { useStartStrengthenSession } from '../api/practice-hooks'
import { ExerciseSessionView } from './exercise-session-view'

// Strengthen session: leech-rehab gate exercises + this-session again/hard
// bonus exercises. Thin wrapper around the shared ExerciseSessionView — it owns
// only the fetch (start hook) and the rehab copy variant.
export const StrengthenView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { targetLanguage } = useParams({ from: '/_authenticated/_app/practice/strengthen/$targetLanguage' })
  const { pool, sessionHard } = useSearch({ from: '/_authenticated/_app/practice/strengthen/$targetLanguage' })
  const languageName = getLanguageName(targetLanguage)

  const { mutate: startSession, isPending, isError } = useStartStrengthenSession()
  const [entries, setEntries] = useState<StrengthenExerciseEntry[] | null>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    startSession(
      { targetLanguage, pool, sessionHardUserLookupIds: sessionHard ?? [] },
      { onSuccess: (resp) => setEntries(resp.data.exercises) }
    )
  }, [startSession, targetLanguage, pool, sessionHard])

  const close = () => void navigate({ to: '/practice/language/$targetLanguage', params: { targetLanguage } })

  return (
    <ExerciseSessionView
      title={t`Strengthen · ${languageName}`}
      copyVariant='rehab'
      entries={entries}
      isPending={isPending}
      isError={isError}
      backLabel={t`Back to ${languageName}`}
      onClose={close}
    />
  )
}

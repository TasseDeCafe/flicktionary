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

  const { mutate: startSession, isError } = useStartStrengthenSession()
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

  // Mid-mix, closing continues the chain to the next language (the composed
  // route's default filter — a mix always runs the everyday queue); otherwise
  // back to the language landing as usual.
  const mixUpcoming = splitMixChain(mix, targetLanguage)?.upcoming ?? []
  const close = () => {
    if (mixUpcoming.length > 0) {
      void navigate({
        to: '/practice/composed/$targetLanguage',
        params: { targetLanguage: mixUpcoming[0] },
        search: { ...DEFAULT_PRACTICE_QUEUE_FILTER, mix },
      })
      return
    }
    void navigate({ to: '/practice/language/$targetLanguage', params: { targetLanguage } })
  }

  return (
    <ExerciseSessionView
      title={t`Strengthen · ${languageName}`}
      copyVariant='rehab'
      entries={entries}
      isError={isError}
      backLabel={t`Back to ${languageName}`}
      onClose={close}
      targetLanguage={targetLanguage}
      practiceMode='strengthen'
      practiceSessionHard={sessionHard}
      practiceMix={mix}
    />
  )
}

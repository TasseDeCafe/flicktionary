import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import { getPracticeLimitsForLanguage } from '@/features/sessions/utils/practice-limits-pref'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { useDueSummary } from '../api/practice-hooks'
import { ReadingModeView } from './reading-mode-view'
import { getDailyNewAvailable, getReviewCounts } from './review-counts'

// The reading-mode session screen. Flashcards moved to the composed queue
// (/practice/composed); this route only hosts Read, entered from Custom
// practice or the landing's reading-resume affordance.
export const UnifiedReviewView = () => {
  const navigate = useNavigate()
  const { targetLanguage } = useParams({ from: '/_authenticated/_app/practice/review/$targetLanguage' })
  const { pool, scope } = useSearch({ from: '/_authenticated/_app/practice/review/$targetLanguage' })
  const { data: summary } = useDueSummary()
  const { data: prefs } = useGetUserPrefs()

  const languageName = getLanguageName(targetLanguage)
  const entry = summary?.find((row) => row.targetLanguage === targetLanguage) ?? null
  const { maxNewTerms } = getPracticeLimitsForLanguage(prefs, targetLanguage)
  const dailyNewAvailable = entry ? getDailyNewAvailable(entry, maxNewTerms) : 0
  const counts = getReviewCounts(entry, pool, dailyNewAvailable)

  const close = () => void navigate({ to: '/practice/language/$targetLanguage', params: { targetLanguage } })

  return (
    <ModalScreen onClose={close} closeIcon='x' title={languageName}>
      <ReadingModeView
        key={`rd-${pool}-${scope}`}
        targetLanguage={targetLanguage}
        pool={pool}
        scope={scope}
        counts={counts}
      />
    </ModalScreen>
  )
}

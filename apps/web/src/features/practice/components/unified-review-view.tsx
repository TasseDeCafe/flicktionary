import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import { getPracticeLimitsForLanguage } from '@/features/sessions/utils/practice-limits-pref'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { useDueSummary } from '../api/practice-hooks'
import { FlashcardModeView } from './flashcard-mode-view'
import { ReadingModeView } from './reading-mode-view'
import { getDailyNewAvailable, getReviewCounts } from './review-counts'

// Render mode, pool, and scope are chosen on the landing (practice-language-view)
// before entry and arrive as search params. The review screen itself stays
// chrome-free — no in-view toggles — so the text/cards get the full height.
export const UnifiedReviewView = () => {
  const navigate = useNavigate()
  const { targetLanguage } = useParams({ from: '/_authenticated/_app/practice/review/$targetLanguage' })
  const { pool, scope, mode, count } = useSearch({ from: '/_authenticated/_app/practice/review/$targetLanguage' })
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
      {mode === 'flashcards' ? (
        <FlashcardModeView
          key={`fc-${pool}-${scope}`}
          targetLanguage={targetLanguage}
          pool={pool}
          scope={scope}
          count={count}
        />
      ) : (
        <ReadingModeView
          key={`rd-${pool}-${scope}`}
          targetLanguage={targetLanguage}
          pool={pool}
          scope={scope}
          counts={counts}
        />
      )}
    </ModalScreen>
  )
}

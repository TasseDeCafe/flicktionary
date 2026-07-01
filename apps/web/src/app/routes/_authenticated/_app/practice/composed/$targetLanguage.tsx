import { createFileRoute, useParams, useSearch } from '@tanstack/react-router'
import { z } from 'zod'
import type { PracticeQueueFilter } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { ComposedPracticeView } from '@/features/practice/components/composed-practice-view'

// The composed-queue filter spec as search params, defaulting to the primary
// "Practice" behavior. .catch (not .default) so garbage/stale tokens degrade
// to the everyday queue instead of a route error. learnExtraCount is
// deliberately NOT a search param — it parks past the daily cap, so it must
// never live somewhere a refresh or back-navigation could replay (the
// completion screen's one-tap re-compose carries it as mutation input).
const composedSearchSchema = z.object({
  pools: z
    .array(z.enum(['recognition', 'production']))
    .min(1)
    .catch(['production', 'recognition']),
  scope: z.enum(['due_only', 'new_only', 'both']).catch('both'),
  render: z.enum(['flashcards_only', 'exercises_only', 'both']).catch('both'),
  autoWarmup: z.boolean().catch(true),
  includeOptInNew: z.boolean().catch(false),
})

const ComposedPracticeRoute = () => {
  const { targetLanguage } = useParams({ from: '/_authenticated/_app/practice/composed/$targetLanguage' })
  const search = useSearch({ from: '/_authenticated/_app/practice/composed/$targetLanguage' })
  const filter: PracticeQueueFilter = search
  // Key on the filter so switching presets remounts a fresh session (the view
  // composes once per mount — one-shot snapshot semantics).
  return <ComposedPracticeView key={JSON.stringify(filter)} targetLanguage={targetLanguage} filter={filter} />
}

export const Route = createFileRoute('/_authenticated/_app/practice/composed/$targetLanguage')({
  validateSearch: composedSearchSchema,
  component: ComposedPracticeRoute,
  staticData: { hideAppChrome: true },
})

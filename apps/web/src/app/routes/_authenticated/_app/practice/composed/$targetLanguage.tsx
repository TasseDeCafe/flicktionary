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
  // Daily Mix: the FULL ordered language chain (done + current + upcoming) —
  // position derives from the route's language param, so the value is stable
  // across the whole run and survives a refresh. Never part of the compose
  // filter.
  mix: z.array(z.string()).optional().catch(undefined),
})

const ComposedPracticeRoute = () => {
  const { targetLanguage } = useParams({ from: '/_authenticated/_app/practice/composed/$targetLanguage' })
  const search = useSearch({ from: '/_authenticated/_app/practice/composed/$targetLanguage' })
  const { mix, ...filter } = search satisfies PracticeQueueFilter & { mix?: string[] }
  // Key on language + filter so both a preset switch AND a mix hop to the next
  // language remount a fresh session (the view composes once per mount —
  // one-shot snapshot semantics; TanStack reuses the route component across
  // param changes). `mix` stays out of the key: the chain annotates the
  // session, it doesn't define it.
  return (
    <ComposedPracticeView
      key={`${targetLanguage}:${JSON.stringify(filter)}`}
      targetLanguage={targetLanguage}
      filter={filter}
      mix={mix}
    />
  )
}

export const Route = createFileRoute('/_authenticated/_app/practice/composed/$targetLanguage')({
  validateSearch: composedSearchSchema,
  component: ComposedPracticeRoute,
  staticData: { hideAppChrome: true },
})

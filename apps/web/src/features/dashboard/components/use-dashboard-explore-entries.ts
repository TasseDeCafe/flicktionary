import { useMemo } from 'react'
import { useGetUserPrefs, useListStudySessions } from '@/features/sessions/api/sessions-hooks'
import { useSharedContentList } from '@/features/explore/api/explore-hooks'

// How many entries each dashboard rail holds; the full catalog lives on
// /explore.
const FEATURED_COUNT = 12
const COMMUNITY_COUNT = 12

// One computation feeding both dashboard shared-content sections, so they
// never repeat each other. Entries already in the user's library are hidden
// everywhere, and once the user has any target language (sessions or a saved
// preference) both sections narrow to those languages — the full
// multi-language catalog with filter chips stays on /explore. Featured takes
// the curated picks; the community rail gets the latest of everything else.
export const useDashboardExploreEntries = () => {
  const { data: sessions, isLoading: isSessionsLoading } = useListStudySessions()
  const { data: prefs } = useGetUserPrefs()
  const { data: entries, isLoading: isEntriesLoading } = useSharedContentList()

  const { featured, community } = useMemo(() => {
    const targetLanguages = new Set((sessions ?? []).map((session) => session.targetLanguage))
    if (prefs?.lastTargetLanguage) targetLanguages.add(prefs.lastTargetLanguage)
    const eligible = (entries ?? []).filter(
      (entry) => !entry.inLibrary && (targetLanguages.size === 0 || targetLanguages.has(entry.language))
    )
    const featuredEntries = eligible.filter((entry) => entry.featured).slice(0, FEATURED_COUNT)
    const featuredIds = new Set(featuredEntries.map((entry) => entry.id))
    const communityEntries = eligible
      .filter((entry) => !featuredIds.has(entry.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, COMMUNITY_COUNT)
    return { featured: featuredEntries, community: communityEntries }
  }, [entries, sessions, prefs?.lastTargetLanguage])

  return { featured, community, isLoading: isSessionsLoading || isEntriesLoading }
}

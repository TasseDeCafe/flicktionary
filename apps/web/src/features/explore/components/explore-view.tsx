import { useMemo } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { PageContainer } from '@/components/page-container'
import { FilterChip } from '@/components/filter-chip'
import { SkeletonList } from '@flicktionary/ui/components/skeleton'
import { OverflowTabHeader } from '@/features/navigation/components/overflow-tab-header'
import { getLocalizedCoverageLanguageName } from '@/features/coverage/utils/coverage-language-names'
import { useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import { useSharedContentList } from '../api/explore-hooks'
import { ExploreCard, ExploreCardSkeleton } from './explore-card'

// The shared-content catalog. An overflow tab view: its own desktop sidebar
// entry, Dashboard stays highlighted on mobile. The language chips double as
// the "what are you learning?" ask for brand-new users — picking one is the
// first language signal a guest gives us.
export const ExploreView = () => {
  const { t, i18n } = useLingui()
  const navigate = useNavigate()
  const { lang } = useSearch({ from: '/_authenticated/_app/explore/' })
  const { data: entries, isLoading } = useSharedContentList()
  const { data: prefs } = useGetUserPrefs()

  const languages = useMemo(() => [...new Set((entries ?? []).map((entry) => entry.language))].sort(), [entries])

  // URL param wins; otherwise preselect the user's last target language when
  // the feed actually has it. An explicit All click writes the 'all' sentinel
  // to the URL — a bare missing param means "no choice made yet", and only
  // that state gets the preference default (otherwise All could never stick
  // for users with a saved language).
  const active = lang && lang !== 'all' && languages.includes(lang) ? lang : null
  const defaulted =
    active === null && !lang && prefs?.lastTargetLanguage && languages.includes(prefs.lastTargetLanguage)
      ? prefs.lastTargetLanguage
      : active

  const visible = defaulted ? (entries ?? []).filter((entry) => entry.language === defaulted) : (entries ?? [])

  const setLanguage = (code: string | null) => {
    void navigate({
      to: '/explore',
      search: { lang: code ?? 'all' },
      replace: true,
    })
  }

  return (
    <>
      <OverflowTabHeader backTo='/dashboard' title={t`Explore`} />
      <PageContainer width='wide'>
        <h1 className='hidden text-2xl font-bold md:block'>{t`Explore`}</h1>
        <p className='text-muted-foreground mt-1 text-sm'>{t`Shared content from the community`}</p>

        {languages.length > 1 && (
          <div className='mt-4 flex flex-wrap gap-2'>
            <FilterChip active={defaulted === null} onClick={() => setLanguage(null)}>
              {t`All`}
            </FilterChip>
            {languages.map((code) => (
              <FilterChip key={code} active={code === defaulted} onClick={() => setLanguage(code)}>
                {getLocalizedCoverageLanguageName(i18n, code)}
              </FilterChip>
            ))}
          </div>
        )}

        <div className='mt-4 grid grid-cols-1 gap-3 md:grid-cols-2'>
          {isLoading && <SkeletonList count={6} renderItem={() => <ExploreCardSkeleton />} />}
          {!isLoading && visible.length === 0 && (
            <p className='text-muted-foreground text-sm md:col-span-2'>
              {t`Nothing shared here yet — content you share from your own library shows up for everyone.`}
            </p>
          )}
          {visible.map((entry) => (
            <ExploreCard key={entry.id} entry={entry} />
          ))}
        </div>
      </PageContainer>
    </>
  )
}

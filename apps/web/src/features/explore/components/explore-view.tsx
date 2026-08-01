import { useMemo } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { PageContainer } from '@/components/page-container'
import { FilterChip } from '@/components/filter-chip'
import { SkeletonList } from '@flicktionary/ui/components/skeleton'
import { OverflowTabHeader } from '@/features/navigation/components/overflow-tab-header'
import { getLocalizedCoverageLanguageName } from '@/features/coverage/utils/coverage-language-names'
import { useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import { checkIsTestUser } from '@/utils/test-users-utils'
import { getUserEmail, useAuthStore } from '@/stores/auth-store'
import { useSharedContentList } from '../api/explore-hooks'
import { useAdminSharedContentList, type SharedContentEntryStatus } from '../api/explore-admin-hooks'
import { ExploreCard, ExploreCardSkeleton } from './explore-card'

const ADMIN_STATUSES: SharedContentEntryStatus[] = ['live', 'unshared', 'removed']

// The shared-content catalog. An overflow tab view: its own desktop sidebar
// entry, Dashboard stays highlighted on mobile. The language chips double as
// the "what are you learning?" ask for brand-new users — picking one is the
// first language signal a guest gives us.
export const ExploreView = () => {
  const { t, i18n } = useLingui()
  const navigate = useNavigate()
  const { lang, status } = useSearch({ from: '/_authenticated/_app/explore/' })
  const isAdmin = checkIsTestUser(useAuthStore(getUserEmail))
  // The admin Live chip deliberately reads the PUBLIC feed — moderating means
  // seeing exactly what users see (featured-first, same cap). Only the
  // non-live chips read the server-filtered admin list.
  const adminStatus: SharedContentEntryStatus | null =
    isAdmin && (status === 'unshared' || status === 'removed') ? status : null
  const publicQuery = useSharedContentList()
  const adminQuery = useAdminSharedContentList(adminStatus ?? 'unshared', adminStatus !== null)
  const entries = adminStatus !== null ? adminQuery.data : publicQuery.data
  const isLoading = adminStatus !== null ? adminQuery.isLoading : publicQuery.isLoading
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
      search: { lang: code ?? 'all', status },
      replace: true,
    })
  }

  const setStatus = (next: SharedContentEntryStatus) => {
    void navigate({
      to: '/explore',
      search: { lang, status: next === 'live' ? undefined : next },
      replace: true,
    })
  }

  return (
    <>
      <OverflowTabHeader backTo='/dashboard' title={t`Explore`} />
      <PageContainer width='wide'>
        <h1 className='hidden text-2xl font-bold md:block'>{t`Explore`}</h1>
        <p className='text-muted-foreground mt-1 text-sm'>{t`Shared content from the community`}</p>

        {/* Moderation filter, test users only (untranslated like the rest of
            the admin surfaces; the server's assertTestUser is the authority). */}
        {isAdmin && (
          <div className='mt-4 flex flex-wrap gap-2'>
            {ADMIN_STATUSES.map((chip) => (
              <FilterChip key={chip} active={(adminStatus ?? 'live') === chip} onClick={() => setStatus(chip)}>
                {chip}
              </FilterChip>
            ))}
          </div>
        )}

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
              {adminStatus !== null
                ? `No ${adminStatus} entries.`
                : t`Nothing shared here yet — content you share from your own library shows up for everyone.`}
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

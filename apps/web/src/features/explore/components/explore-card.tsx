import type { I18n } from '@lingui/core'
import { useLingui } from '@lingui/react/macro'
import type { ContentSourceType } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { getLocalizedCoverageLanguageName } from '@/features/coverage/utils/coverage-language-names'
import { MediaCard, MediaListItem, MediaThumb } from '@/features/sessions/components/media-card'
import { youtubeThumbnailUrl } from '@/features/sessions/utils/session-media'

export type ExploreEntry = {
  id: string
  language: string
  title: string
  type: string
  youtubeVideoId: string | null
  sourceDomain: string | null
  featured: boolean
  createdAt: string
}

// The catalog's visual identity for an entry, shared by the list, the
// dashboard rails, and the detail screen header. YouTube serves a stable
// thumbnail per video id — the one visual the catalog gets for free; other
// types get the procedural letterform artwork.
export const ExploreThumb = ({ entry, className }: { entry: ExploreEntry; className?: string }) => (
  <MediaThumb
    imageUrl={entry.youtubeVideoId ? youtubeThumbnailUrl(entry.youtubeVideoId) : null}
    title={entry.title}
    type={entry.type as ContentSourceType}
    className={className}
  />
)

// The meta line shared by the list and rail cards. Localized like the filter
// chips above the /explore list — the English fallback names would clash with
// them in every non-English UI locale.
const entryMeta = (i18n: I18n, entry: ExploreEntry) =>
  [getLocalizedCoverageLanguageName(i18n, entry.language), entry.sourceDomain]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ')

type Props = {
  entry: ExploreEntry
}

// A catalog entry in the /explore list: same shape as the Sessions list, with
// a chevron instead of a menu — the detail screen owns the actions. The whole
// card is the tap target.
export const ExploreListItem = ({ entry }: Props) => {
  const { t, i18n } = useLingui()
  const entryTitle = entry.title
  return (
    <MediaListItem
      linkProps={{ to: '/explore/$entryId', params: { entryId: entry.id } }}
      ariaLabel={t`Open "${entryTitle}"`}
      media={<ExploreThumb entry={entry} />}
      title={entry.title}
      meta={entryMeta(i18n, entry)}
      chevron
    />
  )
}

// The vertical card for the dashboard's Featured / community rails. Width
// comes from the rail container.
export const ExploreMediaCard = ({ entry, className }: Props & { className?: string }) => {
  const { t, i18n } = useLingui()
  const entryTitle = entry.title
  return (
    <MediaCard
      linkProps={{ to: '/explore/$entryId', params: { entryId: entry.id } }}
      ariaLabel={t`Open "${entryTitle}"`}
      media={<ExploreThumb entry={entry} />}
      title={entry.title}
      meta={entryMeta(i18n, entry)}
      className={className}
    />
  )
}

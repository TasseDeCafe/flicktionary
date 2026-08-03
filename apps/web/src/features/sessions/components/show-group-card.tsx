import { useLingui } from '@lingui/react/macro'
import type { TvShowGroup } from '../utils/derive-tv-shows'
import { useRelativeDateLabel } from '../hooks/use-relative-date-label'
import { MediaCard, MediaListItem, MediaThumb } from './media-card'

type Props = {
  group: TvShowGroup
}

// One entry per TV show in session lists. Tapping opens the show detail screen
// (episode list + Add episode); a mobile-friendly drill-in rather than an
// inline expand. No ⋮ — a group has no single session to act on — so the
// chevron is the affordance. The date is the latest episode's, matching the
// group's position in the recency sort.
const useShowGroupParts = (group: TvShowGroup) => {
  const { t } = useLingui()
  const relativeDate = useRelativeDateLabel()
  const count = group.episodes.length
  return {
    title: group.showTitle,
    dateLabel: relativeDate(group.latestCreatedAt),
    linkProps: { to: '/sessions/show/$tmdbShowId', params: { tmdbShowId: String(group.tmdbShowId) } } as const,
    media: <MediaThumb imageUrl={group.backdropUrl} title={group.showTitle} type='tv' />,
    meta: `${group.language.toUpperCase()} · ${count === 1 ? t`1 episode` : t`${count} episodes`}`,
  }
}

export const ShowGroupListItem = ({ group }: Props) => {
  const { title, dateLabel, linkProps, media, meta } = useShowGroupParts(group)
  return <MediaListItem linkProps={linkProps} media={media} title={title} meta={meta} dateLabel={dateLabel} chevron />
}

export const ShowGroupMediaCard = ({ group, className }: Props & { className?: string }) => {
  const { title, dateLabel, linkProps, media, meta } = useShowGroupParts(group)
  return (
    <MediaCard
      linkProps={linkProps}
      media={media}
      title={title}
      meta={`${meta} · ${dateLabel}`}
      className={className}
    />
  )
}

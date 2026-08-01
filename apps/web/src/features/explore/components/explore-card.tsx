import { Link } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { ChevronRight } from 'lucide-react'
import { Card, CardContent } from '@flicktionary/ui/components/card'
import { Skeleton } from '@flicktionary/ui/components/skeleton'
import type { ContentSourceType } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { getLocalizedCoverageLanguageName } from '@/features/coverage/utils/coverage-language-names'
import { POSTER_PLACEHOLDERS } from '@/features/sessions/components/poster-placeholders'

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

// The catalog's visual identity for an entry, shared by the grid card and the
// detail screen header. YouTube serves a stable thumbnail per video id — the
// one visual the catalog gets for free; other types fall back to the session
// poster placeholders.
export const ExploreThumb = ({ entry, className = 'h-14 w-10' }: { entry: ExploreEntry; className?: string }) => {
  const placeholder = POSTER_PLACEHOLDERS[entry.type as ContentSourceType]
  if (entry.youtubeVideoId) {
    return (
      <img
        src={`https://i.ytimg.com/vi/${entry.youtubeVideoId}/hqdefault.jpg`}
        alt={entry.title}
        className={cn('shrink-0 rounded object-cover', className)}
        loading='lazy'
      />
    )
  }
  if (placeholder) {
    return (
      <div className={cn('flex shrink-0 items-center justify-center rounded', placeholder.className, className)}>
        <placeholder.Icon className='h-5 w-5' />
      </div>
    )
  }
  return <div className={cn('bg-muted shrink-0 rounded', className)} />
}

// Mirrors ExploreCard's layout so the feed doesn't reflow when entries land.
export const ExploreCardSkeleton = () => (
  <Card className='py-0'>
    <CardContent className='flex items-center gap-3 p-3'>
      <Skeleton className='h-14 w-10 shrink-0 rounded' />
      <div className='flex min-w-0 flex-1 flex-col gap-2'>
        <Skeleton className='h-5 w-2/3' />
        <Skeleton className='h-3 w-40' />
      </div>
    </CardContent>
  </Card>
)

type Props = {
  entry: ExploreEntry
}

// A catalog entry: SessionCard's visual language (thumbnail box + title +
// meta) navigating to the entry's detail screen, where the full text and the
// explicit add CTA live. The whole card is the tap target; the trailing
// chevron is the affordance, not a separate control.
export const ExploreCard = ({ entry }: Props) => {
  const { t, i18n } = useLingui()
  const entryTitle = entry.title
  // Localized like the filter chips above the grid — the English fallback
  // names would clash with them in every non-English UI locale.
  const metaParts = [getLocalizedCoverageLanguageName(i18n, entry.language), entry.sourceDomain].filter(
    (part): part is string => part !== null && part !== ''
  )

  return (
    <Card className='hover:bg-accent active:bg-accent relative py-0 transition-colors'>
      <Link
        to='/explore/$entryId'
        params={{ entryId: entry.id }}
        className='block w-full cursor-pointer text-left'
        aria-label={t`Open "${entryTitle}"`}
      >
        <CardContent className='flex items-center gap-3 p-3 pr-12'>
          <ExploreThumb entry={entry} />
          <div className='min-w-0 flex-1'>
            <div className='truncate text-base font-semibold'>{entry.title}</div>
            <div className='text-muted-foreground truncate text-xs'>{metaParts.join(' · ')}</div>
          </div>
        </CardContent>
      </Link>
      <span className='text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2'>
        <ChevronRight className='h-5 w-5' />
      </span>
    </Card>
  )
}

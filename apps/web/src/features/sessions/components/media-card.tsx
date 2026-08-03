import type { ReactNode } from 'react'
import { Link, type LinkProps } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { Card } from '@flicktionary/ui/components/card'
import { Skeleton } from '@flicktionary/ui/components/skeleton'
import type { ContentSourceType } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { LetterformTile } from './letterform-tile'

// The unified media card family: every content surface (dashboard rails and
// grids, Sessions list, Explore) renders the same anatomy — landscape 16:9
// media flush to the card edges, title below, one meta line. Two shapes:
// MediaCard is the vertical card for grids and rails; MediaListItem is the
// list shape — a stacked media card on mobile, a YouTube-search-style
// thumb-left row on desktop.

type MediaThumbProps = {
  imageUrl: string | null
  title: string
  type: ContentSourceType | null | undefined
  className?: string
}

// The 16:9 media block itself — a real image when the content has one, the
// procedural letterform tile when it doesn't, so both crop identically.
export const MediaThumb = ({ imageUrl, title, type, className }: MediaThumbProps) =>
  imageUrl ? (
    <img src={imageUrl} alt='' className={cn('aspect-video w-full object-cover', className)} loading='lazy' />
  ) : (
    <LetterformTile title={title} type={type} className={cn('aspect-video w-full', className)} />
  )

type MediaCardProps = {
  linkProps: LinkProps
  ariaLabel?: string
  media: ReactNode
  title: string
  meta: ReactNode
  // Rendered as an overlay in the meta row's right corner (⋮ menus). The card
  // body is one big Link, so interactive actions must sit outside it.
  action?: ReactNode
  className?: string
}

// Vertical card: media on top (flush, zero padding), 2-line clamped title,
// meta line below with room reserved for the action overlay.
export const MediaCard = ({ linkProps, ariaLabel, media, title, meta, action, className }: MediaCardProps) => (
  <Card
    className={cn(
      'hover:bg-accent active:bg-accent relative h-full gap-0 overflow-hidden py-0 transition-colors',
      className
    )}
  >
    <Link {...linkProps} className='flex h-full flex-col' aria-label={ariaLabel}>
      {media}
      <div className='flex-1 p-3 pt-2'>
        <div className='line-clamp-2 text-sm font-semibold'>{title}</div>
        <div className={cn('text-muted-foreground mt-1 truncate text-xs', action ? 'pr-8' : undefined)}>{meta}</div>
      </div>
    </Link>
    {action && <div className='absolute right-1 bottom-1'>{action}</div>}
  </Card>
)

export const MediaCardSkeleton = ({ className }: { className?: string }) => (
  <Card className={cn('gap-0 overflow-hidden py-0', className)}>
    <Skeleton className='aspect-video w-full rounded-none' />
    <div className='flex flex-col gap-1.5 p-3 pt-2'>
      <Skeleton className='h-4 w-5/6' />
      <Skeleton className='h-3 w-2/3' />
    </div>
  </Card>
)

type MediaListItemProps = {
  linkProps: LinkProps
  ariaLabel?: string
  media: ReactNode
  title: string
  meta: ReactNode
  // Joins the meta line on mobile; sits on the row's right edge on desktop.
  dateLabel?: string
  // ⋮ overlay (outside the Link) — mutually exclusive with the chevron.
  action?: ReactNode
  // Decorative trailing chevron for drill-in rows without their own menu.
  chevron?: boolean
}

// List shape: an edge-to-edge stacked media card on mobile, a thumb-left row
// on desktop. One component so Sessions and Explore stay pixel-identical.
export const MediaListItem = ({
  linkProps,
  ariaLabel,
  media,
  title,
  meta,
  dateLabel,
  action,
  chevron,
}: MediaListItemProps) => (
  <Card className='hover:bg-accent active:bg-accent relative gap-0 overflow-hidden py-0 transition-colors'>
    <Link {...linkProps} className='flex flex-col md:flex-row md:items-stretch' aria-label={ariaLabel}>
      <div className='md:w-[172px] md:shrink-0'>{media}</div>
      <div className='min-w-0 flex-1 p-3 md:flex md:flex-col md:justify-center md:px-4'>
        <div className='line-clamp-2 text-base font-semibold md:truncate'>{title}</div>
        <div
          className={cn('text-muted-foreground mt-1 truncate text-xs', action || chevron ? 'pr-8 md:pr-0' : undefined)}
        >
          {meta}
          {dateLabel && <span className='md:hidden'> · {dateLabel}</span>}
        </div>
      </div>
      <div className={cn('hidden shrink-0 items-center md:flex', action || chevron ? 'md:pr-12' : 'md:pr-4')}>
        {dateLabel && <span className='text-muted-foreground text-sm'>{dateLabel}</span>}
      </div>
    </Link>
    {action && (
      <div className='absolute right-1 bottom-1 md:top-1/2 md:right-2 md:bottom-auto md:-translate-y-1/2'>{action}</div>
    )}
    {!action && chevron && (
      <span className='text-muted-foreground pointer-events-none absolute right-3 bottom-3 md:top-1/2 md:bottom-auto md:-translate-y-1/2'>
        <ChevronRight className='h-5 w-5' />
      </span>
    )}
  </Card>
)

export const MediaListItemSkeleton = () => (
  <Card className='gap-0 overflow-hidden py-0'>
    <div className='flex flex-col md:flex-row md:items-stretch'>
      <Skeleton className='aspect-video w-full rounded-none md:w-[172px] md:shrink-0' />
      <div className='flex min-w-0 flex-1 flex-col gap-2 p-3 md:justify-center md:px-4'>
        <Skeleton className='h-5 w-2/3' />
        <Skeleton className='h-3 w-40' />
      </div>
    </div>
  </Card>
)

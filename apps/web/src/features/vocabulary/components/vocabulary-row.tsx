import type { ChunkRow } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { useLingui } from '@lingui/react/macro'
import { MoreVertical } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { Skeleton } from '@flicktionary/ui/components/skeleton'

// Placeholder shaped like a real VocabularyRow (headword + preview, trailing
// menu slot) so the list doesn't jump when the first page lands.
export const VocabularyRowSkeleton = () => (
  <div className='border-border bg-card flex items-stretch border-b'>
    <div className='flex min-w-0 flex-1 flex-col gap-1.5 px-4 py-3'>
      <Skeleton className='h-4 w-32' />
      <Skeleton className='h-3 w-44' />
    </div>
    <div className='flex shrink-0 items-center pr-2'>
      <Skeleton className='h-8 w-8 rounded-md' />
    </div>
  </div>
)

interface VocabularyRowProps {
  chunk: ChunkRow
  onTap: (chunk: ChunkRow) => void
  onOptions: (chunk: ChunkRow) => void
  style?: React.CSSProperties
}

export const VocabularyRow = ({ chunk, onTap, onOptions, style }: VocabularyRowProps) => {
  const { t } = useLingui()
  // Single-line preview. translation wins over definition (matches the session-vocabulary
  // row convention) — presence-based: with the translations pref off, a stored
  // translation is a manual one the user wants to see.
  const preview = chunk.translation || chunk.definition || ''

  return (
    // Hover/press wash lives on the row so it spans edge to edge — a fill on
    // the tap button alone would stop short of the ⋮ column (the ⋮ keeps its
    // own alpha fill on top, matching the session cards).
    <div
      style={style}
      className='border-border bg-card hover:bg-accent active:bg-accent flex items-stretch border-b transition-colors'
    >
      <button
        type='button'
        onClick={() => onTap(chunk)}
        className='flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left'
      >
        <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
          <div className='flex items-baseline gap-2'>
            <span className='text-foreground truncate text-sm font-semibold'>{chunk.headword}</span>
          </div>
          {preview && <span className='text-muted-foreground truncate text-xs'>{preview}</span>}
        </div>
        {chunk.count > 1 && (
          <div className='flex shrink-0 items-center'>
            <span className='bg-muted text-foreground rounded-full px-2 py-0.5 text-[10px] font-semibold'>
              ×{chunk.count}
            </span>
          </div>
        )}
      </button>
      <div className='flex shrink-0 items-center pr-2'>
        {/* Same ⋮ treatment as the session cards: compact ghost button with an
            alpha fill that stays visible over any hovered surface. */}
        <Button
          type='button'
          variant='ghost'
          size='icon'
          onClick={() => onOptions(chunk)}
          aria-label={t`More options`}
          className='text-muted-foreground hover:text-foreground hover:bg-foreground/10 active:bg-foreground/15 h-8 w-8'
        >
          <MoreVertical className='h-4 w-4' />
        </Button>
      </div>
    </div>
  )
}

import type { ChunkRow } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { useLingui } from '@lingui/react/macro'
import { MoreVertical, Star } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'

interface VocabularyRowProps {
  chunk: ChunkRow
  hideTranslationFields?: boolean
  onTap: (chunk: ChunkRow) => void
  onOptions: (chunk: ChunkRow) => void
  style?: React.CSSProperties
}

const formatDueLabel = (chunk: ChunkRow): { label: string | null; tone: 'due' | 'new' | 'scheduled' } | null => {
  if (chunk.srsState === null) return null
  if (chunk.srsDue === null) return { label: 'new', tone: 'new' }
  const due = new Date(chunk.srsDue).getTime()
  const now = Date.now()
  if (due <= now) return { label: 'due', tone: 'due' }
  return { label: 'scheduled', tone: 'scheduled' }
}

export const VocabularyRow = ({
  chunk,
  hideTranslationFields = false,
  onTap,
  onOptions,
  style,
}: VocabularyRowProps) => {
  const { t } = useLingui()
  const due = formatDueLabel(chunk)
  // Single-line preview. translation wins over definition (matches the triage
  // row convention) — unless the user has show-translations off, in which case
  // we surface the target-language definition instead.
  const preview = hideTranslationFields ? chunk.definition || '' : chunk.translation || chunk.definition || ''

  return (
    <div style={style} className='flex items-stretch border-b border-border bg-card'>
      <button
        type='button'
        onClick={() => onTap(chunk)}
        className='flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left hover:bg-accent active:bg-accent'
      >
        <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
          <div className='flex items-baseline gap-2'>
            <span className='truncate text-sm font-semibold text-foreground'>{chunk.headword}</span>
          </div>
          {preview && <span className='text-muted-foreground truncate text-xs'>{preview}</span>}
        </div>
        <div className='flex shrink-0 items-center gap-2'>
          {chunk.learningMode === 'active' && (
            <span className='inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-amber-800 uppercase dark:bg-amber-400/15 dark:text-amber-300'>
              <Star className='h-3 w-3' />
              {t`Active`}
            </span>
          )}
          {due && (
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase',
                due.tone === 'due' && 'bg-red-100 text-red-800 dark:bg-red-400/15 dark:text-red-300',
                due.tone === 'new' && 'bg-yellow-100 text-yellow-800 dark:bg-yellow-400/15 dark:text-yellow-300',
                due.tone === 'scheduled' && 'bg-muted text-foreground'
              )}
            >
              {due.tone === 'due' && t`Due`}
              {due.tone === 'new' && t`New`}
              {due.tone === 'scheduled' && t`Later`}
            </span>
          )}
          {chunk.count > 1 && (
            <span className='rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-foreground'>
              ×{chunk.count}
            </span>
          )}
        </div>
      </button>
      <button
        type='button'
        onClick={() => onOptions(chunk)}
        aria-label={t`More options`}
        className='flex w-10 shrink-0 items-center justify-center text-muted-foreground hover:bg-accent active:bg-accent'
      >
        <MoreVertical className='h-5 w-5' />
      </button>
    </div>
  )
}

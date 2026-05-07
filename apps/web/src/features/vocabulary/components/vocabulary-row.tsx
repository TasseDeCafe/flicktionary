import type { ChunkRow } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { useLingui } from '@lingui/react/macro'
import { cn } from '@flicktionary/core/utils/tailwind-utils'

interface VocabularyRowProps {
  chunk: ChunkRow
  onTap: (chunk: ChunkRow) => void
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

export const VocabularyRow = ({ chunk, onTap, style }: VocabularyRowProps) => {
  const { t } = useLingui()
  const due = formatDueLabel(chunk)
  // Single-line preview. translation wins over definition (matches the triage
  // row convention) so the user sees the L1 gloss they actually edit.
  const preview = chunk.translation || chunk.definition || ''

  return (
    <button
      type='button'
      onClick={() => onTap(chunk)}
      style={style}
      className='flex w-full items-center gap-3 border-b border-gray-100 bg-white px-4 py-3 text-left hover:bg-gray-50 active:bg-gray-100'
    >
      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <div className='flex items-baseline gap-2'>
          <span className='truncate text-sm font-semibold text-gray-900'>{chunk.headword}</span>
        </div>
        {preview && <span className='text-muted-foreground truncate text-xs'>{preview}</span>}
      </div>
      <div className='flex shrink-0 items-center gap-2'>
        {due && (
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase',
              due.tone === 'due' && 'bg-red-100 text-red-800',
              due.tone === 'new' && 'bg-yellow-100 text-yellow-800',
              due.tone === 'scheduled' && 'bg-gray-100 text-gray-700'
            )}
          >
            {due.tone === 'due' && t`Due`}
            {due.tone === 'new' && t`New`}
            {due.tone === 'scheduled' && t`Later`}
          </span>
        )}
        {chunk.count > 1 && (
          <span className='rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-700'>
            ×{chunk.count}
          </span>
        )}
      </div>
    </button>
  )
}

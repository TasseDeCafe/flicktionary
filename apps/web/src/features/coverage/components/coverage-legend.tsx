import { useLingui } from '@lingui/react/macro'
import { plural } from '@lingui/core/macro'
import { cn } from '@flicktionary/core/utils/tailwind-utils'

type Props = {
  studiedCount: number
  knownCount: number
  // Omitted on the dashboard card: "Not yet" reads fine unnumbered there,
  // while the detail view keeps the full count.
  notYetCount?: number
  mweCount?: number
  className?: string
}

const Swatch = ({ cssVar }: { cssVar: string }) => (
  <span aria-hidden className='inline-block size-2.5 rounded-full' style={{ background: `var(${cssVar})` }} />
)

// The color key is the accessibility relief for the low-contrast dots — the
// counts here (and the hover tooltips) carry the information, never color
// alone.
export const CoverageLegend = ({ studiedCount, knownCount, notYetCount, mweCount = 0, className }: Props) => {
  const { t } = useLingui()
  const studiedLabel = studiedCount.toLocaleString()
  const knownLabel = knownCount.toLocaleString()
  const notYetLabel = notYetCount?.toLocaleString()
  return (
    <div
      className={cn(
        'text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums',
        className
      )}
    >
      <span className='flex items-center gap-1.5'>
        <Swatch cssVar='--coverage-dot-studied' />
        {t`Studied ${studiedLabel}`}
      </span>
      <span className='flex items-center gap-1.5'>
        <Swatch cssVar='--coverage-dot-known' />
        {t`Marked known ${knownLabel}`}
      </span>
      <span className='flex items-center gap-1.5'>
        <Swatch cssVar='--coverage-dot-unknown' />
        {notYetLabel === undefined ? t`Not yet` : t`Not yet ${notYetLabel}`}
      </span>
      {mweCount > 0 && (
        <span className='ml-auto'>{plural(mweCount, { one: '+ # expression', other: '+ # expressions' })}</span>
      )}
    </div>
  )
}

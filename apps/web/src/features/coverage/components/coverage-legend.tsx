import { useLingui } from '@lingui/react/macro'
import { plural } from '@lingui/core/macro'

type Props = {
  studiedCount: number
  knownCount: number
  notYetCount: number
  mweCount: number
}

const Swatch = ({ cssVar }: { cssVar: string }) => (
  <span aria-hidden className='inline-block size-2.5 rounded-[2px]' style={{ background: `var(${cssVar})` }} />
)

// The color key is the accessibility relief for the low-contrast dots — the
// counts here (and the hover tooltips) carry the information, never color
// alone.
export const CoverageLegend = ({ studiedCount, knownCount, notYetCount, mweCount }: Props) => {
  const { t } = useLingui()
  const studiedLabel = studiedCount.toLocaleString()
  const knownLabel = knownCount.toLocaleString()
  const notYetLabel = notYetCount.toLocaleString()
  return (
    <div className='text-muted-foreground mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums'>
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
        {t`Not yet ${notYetLabel}`}
      </span>
      {mweCount > 0 && (
        <span className='ml-auto'>{plural(mweCount, { one: '+ # expression', other: '+ # expressions' })}</span>
      )}
    </div>
  )
}

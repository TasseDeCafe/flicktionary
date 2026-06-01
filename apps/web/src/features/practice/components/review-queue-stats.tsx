import { useLingui } from '@lingui/react/macro'
import type { QueueCounts } from './review-counts'

export const ReviewQueueStats = ({ counts }: { counts: QueueCounts }) => {
  const { t } = useLingui()
  const items = [
    {
      key: 'new',
      label: t`New`,
      value: counts.new,
      className: 'bg-blue-50 text-blue-700 ring-blue-100',
      dotClassName: 'bg-blue-500',
    },
    {
      key: 'learning',
      label: t`Learning`,
      value: counts.learning,
      className: 'bg-rose-50 text-rose-700 ring-rose-100',
      dotClassName: 'bg-rose-500',
    },
    {
      key: 'review',
      label: t`Review`,
      value: counts.review,
      className: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
      dotClassName: 'bg-emerald-500',
    },
  ]

  return (
    <div className='flex items-center justify-center gap-2' aria-label={t`Cards left`}>
      {items.map((item) => (
        <div
          key={item.key}
          className={`flex min-w-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ${item.className}`}
        >
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.dotClassName}`} />
          <span className='tabular-nums'>{item.value.toLocaleString()}</span>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  )
}

import { useMemo } from 'react'

const formatTimestamp = (ms: number | null): string => {
  if (ms === null) return ''
  const totalSeconds = Math.floor(ms / 1000)
  const hh = Math.floor(totalSeconds / 3600)
  const mm = Math.floor((totalSeconds % 3600) / 60)
  const ss = totalSeconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return hh > 0 ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`
}

type Props = {
  id: string
  text: string
  startMs: number | null
  isHighlighted?: boolean
}

export const SegmentRow = ({ id, text, startMs, isHighlighted }: Props) => {
  const ts = useMemo(() => formatTimestamp(startMs), [startMs])
  return (
    <div className='flex items-start gap-3 py-1'>
      <span className='text-muted-foreground w-16 shrink-0 text-right text-xs tabular-nums select-none'>{ts}</span>
      <span data-segment-id={id} className={isHighlighted ? 'flex-1 rounded bg-yellow-100 px-1' : 'flex-1'}>
        {text}
      </span>
    </div>
  )
}

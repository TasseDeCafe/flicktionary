import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useResolvedTheme } from '../hooks/use-resolved-theme'
import {
  hitTest,
  readCoverageColors,
  renderDotGrid,
  renderSkyline,
  type CompactRule,
  type CoverageColors,
  type GridLayout,
} from '../utils/coverage-render'

// Canvas math needs pixel widths, so the responsive split (full wall vs the
// compact top-5k mobile wall) keys off the measured container instead of
// Tailwind breakpoints.
const useContainerWidth = () => {
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.width ?? 0)
      setWidth((prev) => (prev === next ? prev : next))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

// The renderers read their colors per paint so the same canvas adapts to
// theme flips; useResolvedTheme retriggers the read when `.dark` toggles.
const useCoverageColors = (): CoverageColors => {
  const theme = useResolvedTheme()
  return useMemo(() => readCoverageColors(theme), [theme])
}

export type DotHover = { rank: number; clientX: number; clientY: number }

type DotGridProps = {
  states: Uint8Array
  startRank?: number
  endRank: number
  cell: number
  gap: number
  // When set, widths at or under the rule's maxWidth use its range/cells.
  compactRule?: CompactRule
  onDotHover?: (hover: DotHover | null) => void
}

export const CoverageDotGrid = ({
  states,
  startRank = 1,
  endRank,
  cell,
  gap,
  compactRule,
  onDotHover,
}: DotGridProps) => {
  const { ref, width } = useContainerWidth()
  const colors = useCoverageColors()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const layoutRef = useRef<{ layout: GridLayout; startRank: number; count: number } | null>(null)

  const compact = compactRule !== undefined && width > 0 && width <= compactRule.maxWidth
  const effectiveEndRank = compact ? compactRule.endRank : endRank
  const effectiveCell = compact ? compactRule.cell : cell
  const effectiveGap = compact ? compactRule.gap : gap

  useEffect(() => {
    /* eslint-disable react-you-might-not-need-an-effect/no-event-handler -- painting is not a user event: the canvas is imperative and must repaint whenever the measured width (ResizeObserver), the resolved theme (MutationObserver), or the coverage data changes — there is no handler that sees all three */
    const canvas = canvasRef.current
    if (!canvas || width === 0) return
    const layout = renderDotGrid(canvas, {
      states,
      startRank,
      endRank: effectiveEndRank,
      cssWidth: width,
      cell: effectiveCell,
      gap: effectiveGap,
      colors,
      devicePixelRatio: window.devicePixelRatio || 1,
    })
    layoutRef.current = {
      layout,
      startRank,
      count: Math.max(0, Math.min(effectiveEndRank, states.length) - startRank + 1),
    }
    /* eslint-enable react-you-might-not-need-an-effect/no-event-handler */
  }, [states, startRank, effectiveEndRank, effectiveCell, effectiveGap, width, colors])

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (!onDotHover || !layoutRef.current) return
      const rect = event.currentTarget.getBoundingClientRect()
      const rank = hitTest({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        layout: layoutRef.current.layout,
        startRank: layoutRef.current.startRank,
        count: layoutRef.current.count,
      })
      onDotHover(rank === null ? null : { rank, clientX: event.clientX, clientY: event.clientY })
    },
    [onDotHover]
  )

  return (
    <div ref={ref} className='w-full'>
      <canvas
        ref={canvasRef}
        className={`block w-full ${onDotHover ? 'cursor-crosshair' : ''}`}
        onMouseMove={onDotHover ? handleMouseMove : undefined}
        onMouseLeave={onDotHover ? () => onDotHover(null) : undefined}
      />
    </div>
  )
}

type SkylineProps = {
  states: Uint8Array
  bucketSize?: number
  height?: number
}

export const CoverageSkyline = ({ states, bucketSize = 100, height = 130 }: SkylineProps) => {
  const { ref, width } = useContainerWidth()
  const colors = useCoverageColors()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    /* eslint-disable react-you-might-not-need-an-effect/no-event-handler -- same imperative-canvas repaint as CoverageDotGrid: width/theme/data changes have no shared user event */
    const canvas = canvasRef.current
    if (!canvas || width === 0) return
    renderSkyline(canvas, {
      states,
      bucketSize,
      cssWidth: width,
      height,
      colors,
      devicePixelRatio: window.devicePixelRatio || 1,
    })
    /* eslint-enable react-you-might-not-need-an-effect/no-event-handler */
  }, [states, bucketSize, height, width, colors])

  return (
    <div ref={ref} className='w-full'>
      <canvas ref={canvasRef} className='block w-full' />
    </div>
  )
}

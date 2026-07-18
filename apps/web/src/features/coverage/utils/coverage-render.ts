// Pure math + canvas painting for the coverage grid (the "pixel wall", band
// waffles, and skyline). The layout/hit-test math is separated from painting
// so it unit-tests without a canvas. States: 0 unknown / 1 marked known /
// 2 studied; rank r lives at index r − 1.

export const STATE_UNKNOWN = 0
export const STATE_KNOWN = 1
export const STATE_STUDIED = 2

export type CoverageColors = {
  studied: string
  known: string
  unknown: string
}

export type CompactRule = { maxWidth: number; endRank: number; cell: number; gap: number }

// The dashboard card's A/A′ split: below ~480px the wall drops to the top
// 5,000 lemmas (≈94% of all text mass) at smaller cells.
export const CARD_COMPACT_RULE: CompactRule = { maxWidth: 480, endRank: 5000, cell: 3, gap: 1 }

// The canvas renderers can't use Tailwind classes, so their colors live as
// CSS custom properties read per paint; the theme param exists purely so
// memoized callers re-read when the resolved theme flips.
export const readCoverageColors = (_theme: 'light' | 'dark'): CoverageColors => {
  const styles = getComputedStyle(document.documentElement)
  return {
    studied: styles.getPropertyValue('--coverage-dot-studied').trim(),
    known: styles.getPropertyValue('--coverage-dot-known').trim(),
    unknown: styles.getPropertyValue('--coverage-dot-unknown').trim(),
  }
}

export const buildStateArray = (
  denominator: number,
  studiedRanks: readonly number[],
  knownRanks: readonly number[]
): Uint8Array => {
  const states = new Uint8Array(Math.max(0, denominator))
  for (const rank of knownRanks) {
    if (rank >= 1 && rank <= denominator) states[rank - 1] = STATE_KNOWN
  }
  // Studied paints last: it wins a shared lemma (the arrays are disjoint
  // server-side, but the precedence must hold regardless).
  for (const rank of studiedRanks) {
    if (rank >= 1 && rank <= denominator) states[rank - 1] = STATE_STUDIED
  }
  return states
}

export type GridLayout = {
  cols: number
  rows: number
  pitch: number
  cssHeight: number
}

export const computeGridLayout = (params: {
  count: number
  cssWidth: number
  cell: number
  gap: number
}): GridLayout => {
  const pitch = params.cell + params.gap
  const cols = Math.max(1, Math.floor((params.cssWidth + params.gap) / pitch))
  const rows = Math.max(1, Math.ceil(params.count / cols))
  return { cols, rows, pitch, cssHeight: rows * pitch - params.gap }
}

// Maps a pointer position (CSS px, relative to the canvas) to the rank under
// it, or null outside the grid. The whole pitch cell counts as a hit — dots
// are small, so demanding pixel-exact hits would make hovering jittery.
export const hitTest = (params: {
  x: number
  y: number
  layout: GridLayout
  startRank: number
  count: number
}): number | null => {
  const col = Math.floor(params.x / params.layout.pitch)
  const row = Math.floor(params.y / params.layout.pitch)
  if (col < 0 || col >= params.layout.cols || row < 0) return null
  const index = row * params.layout.cols + col
  if (index >= params.count) return null
  return params.startRank + index
}

export const renderDotGrid = (
  canvas: HTMLCanvasElement,
  params: {
    states: Uint8Array
    // Inclusive rank range to render; clamped to the states array.
    startRank: number
    endRank: number
    cssWidth: number
    cell: number
    gap: number
    colors: CoverageColors
    devicePixelRatio: number
  }
): GridLayout => {
  const endRank = Math.min(params.endRank, params.states.length)
  const count = Math.max(0, endRank - params.startRank + 1)
  const layout = computeGridLayout({
    count,
    cssWidth: params.cssWidth,
    cell: params.cell,
    gap: params.gap,
  })
  const dpr = params.devicePixelRatio
  canvas.width = Math.round(params.cssWidth * dpr)
  canvas.height = Math.round(layout.cssHeight * dpr)
  canvas.style.height = `${layout.cssHeight}px`
  const ctx = canvas.getContext('2d')
  if (!ctx) return layout
  ctx.scale(dpr, dpr)
  const radius = Math.min(2, params.cell / 2)
  const fills: Array<[number, string]> = [
    [STATE_UNKNOWN, params.colors.unknown],
    [STATE_KNOWN, params.colors.known],
    [STATE_STUDIED, params.colors.studied],
  ]
  // One path per state keeps this at three fill calls even for 60k dots.
  for (const [state, color] of fills) {
    ctx.fillStyle = color
    ctx.beginPath()
    for (let i = 0; i < count; i++) {
      if (params.states[params.startRank - 1 + i] !== state) continue
      const x = (i % layout.cols) * layout.pitch
      const y = Math.floor(i / layout.cols) * layout.pitch
      ctx.roundRect(x, y, params.cell, params.cell, radius)
    }
    ctx.fill()
  }
  return layout
}

export type SkylineBucket = { studied: number; known: number }

export const computeSkylineBuckets = (states: Uint8Array, bucketSize: number): SkylineBucket[] => {
  const buckets: SkylineBucket[] = []
  for (let start = 0; start < states.length; start += bucketSize) {
    let studied = 0
    let known = 0
    const end = Math.min(start + bucketSize, states.length)
    for (let i = start; i < end; i++) {
      if (states[i] === STATE_STUDIED) studied++
      else if (states[i] === STATE_KNOWN) known++
    }
    buckets.push({ studied, known })
  }
  return buckets
}

export const renderSkyline = (
  canvas: HTMLCanvasElement,
  params: {
    states: Uint8Array
    bucketSize: number
    cssWidth: number
    height: number
    colors: CoverageColors
    devicePixelRatio: number
  }
): void => {
  const buckets = computeSkylineBuckets(params.states, params.bucketSize)
  if (buckets.length === 0) return
  const dpr = params.devicePixelRatio
  canvas.width = Math.round(params.cssWidth * dpr)
  canvas.height = Math.round(params.height * dpr)
  canvas.style.height = `${params.height}px`
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(dpr, dpr)
  const gap = 1
  const colWidth = (params.cssWidth - gap * (buckets.length - 1)) / buckets.length
  buckets.forEach((bucket, index) => {
    const x = index * (colWidth + gap)
    // The last bucket can be a partial one; its stack heights stay
    // proportional to the full bucket size so columns compare honestly.
    const studiedHeight = (bucket.studied / params.bucketSize) * params.height
    const knownHeight = (bucket.known / params.bucketSize) * params.height
    ctx.fillStyle = params.colors.unknown
    ctx.fillRect(x, 0, colWidth, params.height)
    ctx.fillStyle = params.colors.known
    ctx.fillRect(x, params.height - studiedHeight - knownHeight, colWidth, knownHeight)
    ctx.fillStyle = params.colors.studied
    ctx.fillRect(x, params.height - studiedHeight, colWidth, studiedHeight)
  })
}

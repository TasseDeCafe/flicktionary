import { useId } from 'react'
import type { ContentSourceType } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { cn } from '@flicktionary/core/utils/tailwind-utils'

// Procedural artwork for sources without an image: the title's first letter as
// an oversized serif glyph — a saturated fill over a lighter offset copy, plus
// a small outlined echo cropped at the bottom-left corner — on a grainy tinted
// background. Deterministic per title (seeded rotation/position), tinted per
// content type with the same hue coding as the old icon tiles. The 16:9
// artwork is composed in a fixed viewBox and sliced like object-cover, so any
// tile aspect (portrait list thumb, landscape card media) crops the same art.

type Palette = { bg: string; main: string; shadow: string; outline: string }

const DEFAULT_PALETTE: Palette = {
  bg: 'bg-stone-200 dark:bg-stone-400/10',
  main: 'fill-stone-500 dark:fill-stone-400',
  shadow: 'fill-stone-300 dark:fill-stone-400/25',
  outline: 'stroke-stone-600/50 dark:stroke-stone-400/40',
}

const PALETTES: Partial<Record<ContentSourceType, Palette>> = {
  text: {
    bg: 'bg-yellow-100 dark:bg-yellow-400/10',
    main: 'fill-yellow-500 dark:fill-yellow-400',
    shadow: 'fill-yellow-300 dark:fill-yellow-400/25',
    outline: 'stroke-yellow-700/50 dark:stroke-yellow-400/40',
  },
  article: {
    bg: 'bg-sky-100 dark:bg-sky-400/10',
    main: 'fill-sky-500 dark:fill-sky-400',
    shadow: 'fill-sky-300 dark:fill-sky-400/25',
    outline: 'stroke-sky-700/50 dark:stroke-sky-400/40',
  },
  lesson: {
    bg: 'bg-violet-100 dark:bg-violet-400/10',
    main: 'fill-violet-500 dark:fill-violet-400',
    shadow: 'fill-violet-300 dark:fill-violet-400/25',
    outline: 'stroke-violet-700/50 dark:stroke-violet-400/40',
  },
  youtube: {
    bg: 'bg-red-100 dark:bg-red-400/10',
    main: 'fill-red-500 dark:fill-red-400',
    shadow: 'fill-red-300 dark:fill-red-400/25',
    outline: 'stroke-red-700/50 dark:stroke-red-400/40',
  },
  streaming: {
    bg: 'bg-indigo-100 dark:bg-indigo-400/10',
    main: 'fill-indigo-500 dark:fill-indigo-400',
    shadow: 'fill-indigo-300 dark:fill-indigo-400/25',
    outline: 'stroke-indigo-700/50 dark:stroke-indigo-400/40',
  },
  tv: {
    bg: 'bg-emerald-100 dark:bg-emerald-400/10',
    main: 'fill-emerald-500 dark:fill-emerald-400',
    shadow: 'fill-emerald-300 dark:fill-emerald-400/25',
    outline: 'stroke-emerald-700/50 dark:stroke-emerald-400/40',
  },
  movie: {
    bg: 'bg-orange-100 dark:bg-orange-400/10',
    main: 'fill-orange-500 dark:fill-orange-400',
    shadow: 'fill-orange-300 dark:fill-orange-400/25',
    outline: 'stroke-orange-700/50 dark:stroke-orange-400/40',
  },
  book: {
    bg: 'bg-teal-100 dark:bg-teal-400/10',
    main: 'fill-teal-500 dark:fill-teal-400',
    shadow: 'fill-teal-300 dark:fill-teal-400/25',
    outline: 'stroke-teal-700/50 dark:stroke-teal-400/40',
  },
}

// FNV-1a, so the same title always gets the same composition.
const hashTitle = (value: string) => {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

// First letter or digit — titles often open with quotes, «guillemets», or
// emoji, which make poor glyphs.
const pickGlyph = (title: string) => {
  const match = title.match(/\p{L}|\p{N}/u)
  return (match?.[0] ?? title.trim()[0] ?? 'A').toLocaleUpperCase()
}

const SERIF_STACK = "Georgia, 'Times New Roman', serif"

type Props = {
  title: string
  type: ContentSourceType | null | undefined
  className?: string
}

export const LetterformTile = ({ title, type, className }: Props) => {
  // useId's colons break url(#…) fragment references in SVG.
  const grainId = useId().replace(/:/g, '')
  const palette = (type && PALETTES[type]) || DEFAULT_PALETTE
  const glyph = pickGlyph(title)
  const seed = hashTitle(title)
  const rotation = (seed % 13) - 9
  const mainX = 350 + ((seed >>> 4) % 110)

  return (
    <div aria-hidden className={cn('relative shrink-0 overflow-hidden select-none', palette.bg, className)}>
      <svg
        viewBox='0 0 640 360'
        preserveAspectRatio='xMidYMid slice'
        className='absolute inset-0 h-full w-full'
        role='presentation'
      >
        <defs>
          <filter id={grainId}>
            <feTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch' />
            <feColorMatrix type='matrix' values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.05 0' />
          </filter>
        </defs>
        <g fontFamily={SERIF_STACK} fontWeight={700} textAnchor='middle'>
          <text x={40} y={440} fontSize={210} fill='none' strokeWidth={3} className={palette.outline}>
            {glyph}
          </text>
          <g transform={`rotate(${rotation} ${mainX} 200)`}>
            <text x={mainX + 24} y={416} fontSize={430} className={palette.shadow}>
              {glyph}
            </text>
            <text x={mainX} y={400} fontSize={430} className={palette.main}>
              {glyph}
            </text>
          </g>
        </g>
        <rect width='640' height='360' filter={`url(#${grainId})`} />
      </svg>
    </div>
  )
}

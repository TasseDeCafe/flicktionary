import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { getWordRanges } from '@/lib/dom/word-segmenter'
import { buildSentencePieces, type SentenceRange } from '../utils/sentence-pieces'

// Exercise-sentence counterpart of AnnotatedText's word tokenization: renders
// a sentence as selectable word pieces (the use-word-selection span contract)
// so a GlossableArea ancestor can turn taps/drags into gloss lookups. Unlike
// AnnotatedText it knows nothing about annotations; instead it handles the two
// exercise-specific shapes — a cloze blank and an underlined/blocked term span.
interface SelectableSentenceProps {
  text: string
  targetLanguage: string
  // Must match this sentence's entry in the enclosing GlossableArea's owners
  // map (the emitted offsets index `text`).
  ownerKey: string
  // When false, renders flat unselectable text (blank/underline still apply).
  enabled?: boolean
  // Cloze gap: text[start..end) is the hidden answer — rendered as ______ and
  // never selectable (the GlossableArea owner must also reject the range).
  blank?: SentenceRange | null
  // Underline styling only (the term span). Independent from blocking: the
  // comprehension term stays underlined after the answer unlocks it.
  highlight?: SentenceRange | null
  // Words intersecting these render unselectable (pre-answer term span).
  blockedRanges?: SentenceRange[]
  as?: 'p' | 'span'
  className?: string
}

const HIGHLIGHT_CLASSES = 'font-semibold underline decoration-yellow-400 decoration-2 underline-offset-4'

export const SelectableSentence = ({
  text,
  targetLanguage,
  ownerKey,
  enabled = true,
  blank = null,
  highlight = null,
  blockedRanges = [],
  as: Tag = 'p',
  className,
}: SelectableSentenceProps) => {
  const pieces = buildSentencePieces({
    text,
    wordRanges: getWordRanges(text, targetLanguage),
    blank,
    blockedRanges,
  })
  const isHighlighted = (start: number, end: number) =>
    highlight !== null && start < highlight.end && highlight.start < end

  return (
    <Tag
      data-word-owner={ownerKey}
      className={cn(className, enabled && 'touch-pan-y select-none')}
      style={enabled ? { WebkitTouchCallout: 'none' } : undefined}
    >
      {pieces.map((piece, i) => {
        if (piece.kind === 'blank') {
          return (
            <span key={i} aria-hidden className='text-muted-foreground mx-1 font-semibold tracking-wider select-none'>
              ______
            </span>
          )
        }
        const highlighted = isHighlighted(piece.start, piece.end)
        if (piece.kind === 'word' && enabled) {
          return (
            <span
              key={i}
              data-word-piece=''
              data-word-start={piece.start}
              data-word-end={piece.end}
              className={cn('cursor-pointer', highlighted && HIGHLIGHT_CLASSES)}
            >
              {piece.text}
            </span>
          )
        }
        // Plain filler (whitespace/punctuation/blocked word). Still a
        // data-word-piece when selection is live so the paint band sweeps
        // continuously across it — just with no offsets, so it can't be a
        // selection endpoint.
        return (
          <span key={i} data-word-piece={enabled ? '' : undefined} className={cn(highlighted && HIGHLIGHT_CLASSES)}>
            {piece.text}
          </span>
        )
      })}
    </Tag>
  )
}

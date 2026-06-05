// Renders a cloze sentence with the answer span replaced by a visible gap.
// Offsets come from the server (computed by substring search at generation
// time), so plain slicing is safe. The gap is literal underscores rather than
// a styled border so it can't silently vanish (border utilities have proven
// fragile) and reads unmistakably as "fill me in".
export const BlankedSentence = ({
  sentence,
  blankStart,
  blankEnd,
}: {
  sentence: string
  blankStart: number
  blankEnd: number
}) => (
  <p className='text-lg leading-relaxed'>
    {sentence.slice(0, blankStart)}
    <span aria-hidden className='text-muted-foreground mx-1 font-semibold tracking-wider select-none'>
      ______
    </span>
    {sentence.slice(blankEnd)}
  </p>
)

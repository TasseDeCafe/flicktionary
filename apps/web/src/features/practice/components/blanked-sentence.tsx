// Renders a cloze sentence with the answer span replaced by a visible gap.
// Offsets come from the server (computed by substring search at generation
// time), so plain slicing is safe.
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
    <span className='mx-1 inline-block min-w-16 rounded border-b-2 border-dashed border-gray-400 align-baseline'>
      &nbsp;
    </span>
    {sentence.slice(blankEnd)}
  </p>
)

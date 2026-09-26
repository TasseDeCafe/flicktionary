// The matched word emphasized inside its context window. Matching can be
// homograph-fuzzy, so the sentence is the user's chance to catch a false
// positive before acting on a word — when the surface isn't found (or is
// null, e.g. pre-evidence checkpoints) the plain context still renders.
export const EvidenceLine = ({ surface, context }: { surface: string | null; context: string | null }) => {
  if (!context) return null
  const at = surface ? context.toLowerCase().indexOf(surface.toLowerCase()) : -1
  return (
    <span className='text-muted-foreground mt-0.5 block text-xs'>
      {at === -1 || !surface ? (
        context
      ) : (
        <>
          {context.slice(0, at)}
          <span className='text-foreground font-semibold'>{context.slice(at, at + surface.length)}</span>
          {context.slice(at + surface.length)}
        </>
      )}
    </span>
  )
}

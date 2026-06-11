import type { ReactNode } from 'react'
import { Badge } from './badge'
import { Skeleton } from './skeleton'
import { FloatingSheetDescription } from './floating-sheet'

type GlossCardBodyProps = {
  loading: boolean
  // Null until the gloss is ready (error/idle states render only the sr text).
  gloss: string | null
  pos: string | null
  register: string | null
  // Resolved by the caller (pickIpa + dialect + "No Wiktionary IPA" fallback) —
  // the caller owns user prefs and language constants.
  ipaLabel: string | null
  // Slot for the English dialect flag (an app-level component).
  ipaPrefix?: ReactNode
  // Accessibility fallback announced while there is no visible gloss text.
  srDescription: string
}

// The shared gloss-card body: IPA row, one-line gloss, POS/register badges and
// their loading skeletons. Used by every gloss-save popover (session gloss
// sheet, generated-texts lookup sheet) so the card reads identically across
// surfaces. Must render inside a FloatingSheet (the description component
// reads its context).
export const GlossCardBody = ({
  loading,
  gloss,
  pos,
  register,
  ipaLabel,
  ipaPrefix,
  srDescription,
}: GlossCardBodyProps) => {
  if (loading) {
    return (
      <>
        <Skeleton className='h-5 w-20' />
        <Skeleton className='h-4 w-11/12' />
        <Skeleton className='h-4 w-3/4' />
        <div className='mt-1 flex flex-wrap gap-1.5'>
          <Skeleton className='h-5 w-12 rounded-md' />
          <Skeleton className='h-5 w-16 rounded-md' />
        </div>
        <FloatingSheetDescription className='sr-only'>{srDescription}</FloatingSheetDescription>
      </>
    )
  }
  return (
    <>
      {ipaLabel && (
        <p className='text-muted-foreground flex items-center gap-1.5 text-base leading-snug font-medium'>
          {ipaPrefix}
          <span>{ipaLabel}</span>
        </p>
      )}
      {gloss !== null ? (
        <FloatingSheetDescription>{gloss}</FloatingSheetDescription>
      ) : (
        <FloatingSheetDescription className='sr-only'>{srDescription}</FloatingSheetDescription>
      )}
      {gloss !== null && (pos || register) && (
        <div className='mt-1 flex flex-wrap gap-1.5'>
          {pos && <Badge variant='outline'>{pos}</Badge>}
          {register && <Badge variant='secondary'>{register}</Badge>}
        </div>
      )}
    </>
  )
}

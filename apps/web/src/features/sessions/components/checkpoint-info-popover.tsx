import { Info } from 'lucide-react'
import { useLingui } from '@lingui/react/macro'
import { Link } from '@tanstack/react-router'
import { Button } from '@flicktionary/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@flicktionary/ui/components/popover'

// The checkpoint button's label is deliberately the comprehension assertion
// ("I understood up to here"), not an action — so what pressing it actually
// does stays invisible. This (i) popover carries that explanation, with the
// user guide's checkpoint section as the long form.
export const CheckpointInfoPopover = ({ className }: { className?: string }) => {
  const { t } = useLingui()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant='ghost'
          size='icon'
          aria-label={t`What does this button do?`}
          className={`text-muted-foreground hover:text-foreground h-8 w-8 shrink-0 ${className ?? ''}`}
        >
          <Info className='size-4' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-80 text-sm leading-6'>
        <p>
          {t`Pressing this tells Flicktionary you read and understood the text up to this point. Saved words that appeared in it and were due for review are counted as successful reviews automatically — no flashcards needed. Words you looked up along the way are simply skipped, never penalized. You can undo from the toast right after.`}
        </p>
        <p className='mt-2'>
          <Link
            to='/user-guide'
            hash='checkpoint-reviews'
            className='hover:text-foreground underline underline-offset-2'
          >
            {t`Learn more in the user guide`}
          </Link>
        </p>
      </PopoverContent>
    </Popover>
  )
}

import { BookOpen, ExternalLink } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { Trans } from '@lingui/react/macro'

interface Props {
  onOpenApp: () => void
  onOpenUserGuide: () => void
}

// Shared top affordance for both popup variants: side-by-side buttons that
// open the Flicktionary web app and the public user guide.
export const PopupHeader = ({ onOpenApp, onOpenUserGuide }: Props) => {
  return (
    <div className='flex gap-2'>
      <Button type='button' className='flex-1' onClick={onOpenApp}>
        <ExternalLink />
        <Trans>Open App</Trans>
      </Button>
      <Button type='button' variant='secondary' className='flex-1' onClick={onOpenUserGuide}>
        <BookOpen />
        <Trans>User Guide</Trans>
      </Button>
    </div>
  )
}

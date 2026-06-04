import { ExternalLink } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { Trans } from '@lingui/react/macro'

interface Props {
  onOpenApp: () => void
}

// Shared top affordance for both popup variants: a single full-width button that
// opens the Flicktionary web app.
export const PopupHeader = ({ onOpenApp }: Props) => {
  return (
    <Button type='button' className='w-full' onClick={onOpenApp}>
      <ExternalLink />
      <Trans>Open App</Trans>
    </Button>
  )
}

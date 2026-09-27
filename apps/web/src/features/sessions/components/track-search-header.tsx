import { useLingui } from '@lingui/react/macro'
import { Button } from '@flicktionary/ui/components/button'
import { SearchInput } from '@flicktionary/ui/components/search-input'

type Props = {
  value: string
  onChange: (value: string) => void
  onCancel: () => void
}

// Takes over the reader's header bar while searching (same box as
// ModalScreenHeader, so the swap doesn't shift the text). The close X is
// deliberately gone in this mode: Cancel is the only exit, so dismissing the
// search can't be mistaken for leaving the session.
export const TrackSearchHeader = ({ value, onChange, onCancel }: Props) => {
  const { t } = useLingui()
  return (
    <header className='bg-background flex h-14 shrink-0 items-center gap-2 border-b px-2'>
      <SearchInput value={value} onChange={onChange} placeholder={t`Search…`} autoFocus className='min-w-0 flex-1' />
      <Button variant='ghost' onClick={onCancel}>
        {t`Cancel`}
      </Button>
    </header>
  )
}

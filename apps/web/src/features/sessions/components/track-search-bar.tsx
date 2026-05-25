import { useLingui } from '@lingui/react/macro'
import { SearchInput } from '@/components/ui/search-input'

type Props = {
  value: string
  onChange: (value: string) => void
}

export const TrackSearchBar = ({ value, onChange }: Props) => {
  const { t } = useLingui()
  return <SearchInput value={value} onChange={onChange} placeholder={t`Search…`} className='w-full' />
}

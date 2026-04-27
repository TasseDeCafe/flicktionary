import { useLingui } from '@lingui/react/macro'
import { Input } from '@/components/ui/input'

type Props = {
  value: string
  onChange: (value: string) => void
}

export const TrackSearchBar = ({ value, onChange }: Props) => {
  const { t } = useLingui()
  return (
    <Input
      type='search'
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={t`Search the subtitle track…`}
      className='w-full'
    />
  )
}

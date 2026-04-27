import { useLingui } from '@lingui/react/macro'
import { Button } from '@/components/ui/button'
import { Download } from 'lucide-react'
import { useExportSessionCsv } from '../api/review-hooks'

type Props = {
  sessionId: string
  keptCount: number
}

export const CsvExportButton = ({ sessionId, keptCount }: Props) => {
  const { t } = useLingui()
  const { mutate: exportCsv, isPending } = useExportSessionCsv()

  const handleClick = () => {
    if (keptCount === 0 || isPending) return
    exportCsv(
      { sessionId },
      {
        onSuccess: (response) => {
          const blob = new Blob([response.data.csv], { type: 'text/csv;charset=utf-8;' })
          const url = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = url
          link.download = `${sessionId}.csv`
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)
          URL.revokeObjectURL(url)
        },
      }
    )
  }

  return (
    <Button onClick={handleClick} disabled={keptCount === 0 || isPending}>
      <Download className='mr-2 h-4 w-4' />
      {isPending ? t`Exporting…` : t`Export ${keptCount} kept cards`}
    </Button>
  )
}

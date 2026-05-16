import { useLingui } from '@lingui/react/macro'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import {
  ResponsiveOverlay,
  OverlayContent,
  OverlayDescription,
  OverlayHeader,
  OverlayTitle,
} from '@/components/ui/responsive-overlay'
import { OverlayActionRow } from '@/components/ui/overlay-action-row'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { useExportVocabularyCsv } from '../api/vocabulary-hooks'

interface VocabularyOptionsOverlayProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  targetLanguage: string | null
}

export const VocabularyOptionsOverlay = ({ open, onOpenChange, targetLanguage }: VocabularyOptionsOverlayProps) => {
  const { t } = useLingui()
  const { mutate: exportCsv, isPending } = useExportVocabularyCsv()

  const handleExport = () => {
    if (!targetLanguage) return
    exportCsv(
      { targetLanguage },
      {
        onSuccess: (response) => {
          const blob = new Blob([response.data.csv], { type: 'text/csv;charset=utf-8;' })
          const url = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = url
          link.download = `flicktionary-vocabulary-${targetLanguage}.csv`
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)
          URL.revokeObjectURL(url)
          const chunkCount = response.data.chunkCount
          toast.success(t`Exported ${chunkCount} term(s)`)
          onOpenChange(false)
        },
      }
    )
  }

  return (
    <ResponsiveOverlay open={open} onOpenChange={onOpenChange}>
      <OverlayContent>
        <OverlayHeader>
          <OverlayTitle>{t`Vocabulary options`}</OverlayTitle>
          <OverlayDescription className='sr-only'>{t`Actions for the selected vocabulary list.`}</OverlayDescription>
        </OverlayHeader>
        <div className='flex flex-col gap-1 px-2 pb-2'>
          <OverlayActionRow
            icon={Download}
            label={isPending ? t`Exporting…` : t`Export vocabulary`}
            description={(() => {
              if (!targetLanguage) return t`Pick a language first`
              const languageName = getLanguageName(targetLanguage)
              return t`Download all kept terms for ${languageName} as CSV (Anki-compatible)`
            })()}
            disabled={isPending || !targetLanguage}
            onClick={handleExport}
          />
        </div>
      </OverlayContent>
    </ResponsiveOverlay>
  )
}

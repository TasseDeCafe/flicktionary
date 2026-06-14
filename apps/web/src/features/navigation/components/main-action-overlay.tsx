import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Clapperboard, FileText, Sparkles, type LucideIcon } from 'lucide-react'
import {
  ResponsiveOverlay,
  OverlayContent,
  OverlayDescription,
  OverlayHeader,
  OverlayTitle,
  useCloseOverlay,
} from '@/components/ui/responsive-overlay'
import { OverlayActionRow } from '@flicktionary/ui/components/overlay-action-row'

type ActionRow = {
  icon: LucideIcon
  label: string
  description?: string
  onSelect: () => void
}

const ActionRowItem = ({ row }: { row: ActionRow }) => {
  const closeOverlay = useCloseOverlay()
  const handleClick = () => {
    row.onSelect()
    closeOverlay()
  }
  return <OverlayActionRow icon={row.icon} label={row.label} description={row.description} onClick={handleClick} />
}

interface MainActionOverlayProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const MainActionOverlay = ({ open, onOpenChange }: MainActionOverlayProps) => {
  const { t } = useLingui()
  const navigate = useNavigate()

  const rows: ActionRow[] = [
    {
      icon: Clapperboard,
      label: t`Start a movie or TV session`,
      description: t`Find a movie or show and load its subtitles`,
      onSelect: () => {
        void navigate({ to: '/sessions/new' })
      },
    },
    {
      icon: FileText,
      label: t`Practice with a text`,
      description: t`Paste an article, comment, or post`,
      onSelect: () => {
        void navigate({ to: '/sessions/new-text' })
      },
    },
    {
      icon: Sparkles,
      label: t`Add a word`,
      description: t`Save a term you heard or saw, no source needed`,
      onSelect: () => {
        void navigate({ to: '/vocabulary/new-word' })
      },
    },
  ]

  return (
    <ResponsiveOverlay open={open} onOpenChange={onOpenChange}>
      <OverlayContent>
        <OverlayHeader>
          <OverlayTitle>{t`Start something new`}</OverlayTitle>
          <OverlayDescription className='sr-only'>{t`Pick what to create next.`}</OverlayDescription>
        </OverlayHeader>
        <div className='flex flex-col gap-1 px-2 pb-4'>
          {rows.map((row) => (
            <ActionRowItem key={row.label} row={row} />
          ))}
        </div>
      </OverlayContent>
    </ResponsiveOverlay>
  )
}

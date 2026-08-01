import { Clapperboard, FileText, GraduationCap, MonitorPlay, Newspaper, Tv } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ContentSourceType } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

// Poster fallback per source type: an icon on a hue that identifies the type
// at a glance. Types without an entry (movie without a poster) fall back to a
// plain muted box. Shared by SessionCard and the Explore catalog cards so a
// YouTube or article entry looks the same before and after it lands in the
// library.
export const POSTER_PLACEHOLDERS: Partial<Record<ContentSourceType, { Icon: LucideIcon; className: string }>> = {
  text: { Icon: FileText, className: 'bg-yellow-100 text-yellow-900 dark:bg-yellow-400/15 dark:text-yellow-300' },
  tv: { Icon: Tv, className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300' },
  article: { Icon: Newspaper, className: 'bg-sky-100 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300' },
  youtube: { Icon: MonitorPlay, className: 'bg-red-100 text-red-700 dark:bg-red-400/15 dark:text-red-300' },
  streaming: {
    Icon: Clapperboard,
    className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300',
  },
  lesson: {
    Icon: GraduationCap,
    className: 'bg-violet-100 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300',
  },
}

import { createFileRoute } from '@tanstack/react-router'
import { UserGuideView } from '@/features/user-guide/components/user-guide-view'

// Public — linked from the extension (FTUE page + popup User Guide button).
export const Route = createFileRoute('/user-guide')({
  component: UserGuideView,
})

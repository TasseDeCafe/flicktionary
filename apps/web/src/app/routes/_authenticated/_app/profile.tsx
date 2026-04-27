import { createFileRoute } from '@tanstack/react-router'
import { ProfileView } from '@/features/profile/components/profile-view'

export const Route = createFileRoute('/_authenticated/_app/profile')({
  component: ProfileView,
})

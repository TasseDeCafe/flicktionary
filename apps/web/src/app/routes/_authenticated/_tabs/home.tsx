import { createFileRoute } from '@tanstack/react-router'
import { HomeView } from '@/features/home/components/home-view'

export const Route = createFileRoute('/_authenticated/_tabs/home')({
  component: HomeView,
})

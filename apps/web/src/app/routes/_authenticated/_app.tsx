import { createFileRoute } from '@tanstack/react-router'
import { AppShellLayout } from '@/features/navigation/components/app-shell-layout'

export const Route = createFileRoute('/_authenticated/_app')({
  component: AppShellLayout,
})

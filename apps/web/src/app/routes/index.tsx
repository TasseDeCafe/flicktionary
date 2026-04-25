import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    // Redirect to home tab - using string here as route imports create circular dependency
    throw redirect({ to: '/home' })
  },
})

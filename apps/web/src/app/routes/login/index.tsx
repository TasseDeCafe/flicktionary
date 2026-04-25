import { createFileRoute } from '@tanstack/react-router'
import { LoginView } from '@/features/auth/components/login-view.tsx'
import { z } from 'zod'

const loginSearchSchema = z.object({
  redirect: z.string().optional(),
})

export const Route = createFileRoute('/login/')({
  validateSearch: loginSearchSchema,
  component: LoginView,
})

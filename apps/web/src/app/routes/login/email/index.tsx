import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { LoginEmailView } from '@/features/auth/components/login-email-view.tsx'

const loginEmailSearchSchema = z.object({
  redirect: z.string().optional(),
})

export const Route = createFileRoute('/login/email/')({
  validateSearch: loginEmailSearchSchema,
  component: LoginEmailView,
})

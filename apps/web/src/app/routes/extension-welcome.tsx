import { createFileRoute } from '@tanstack/react-router'
import { ExtensionWelcomeView } from '@/features/extension-welcome/components/extension-welcome-view'

// Public — opened by the extension's onInstalled handler and set as its
// uninstall URL; must work signed-out.
export const Route = createFileRoute('/extension-welcome')({
  component: ExtensionWelcomeView,
})

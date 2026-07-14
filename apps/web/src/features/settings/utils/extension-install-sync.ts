import type { ExtensionDetection } from '@/lib/extension/use-extension-detected'

export const shouldRecordExtensionInstall = ({
  detection,
  userId,
  accountFlags,
  attemptedUserId,
}: {
  detection: ExtensionDetection
  userId: string
  accountFlags: string[] | undefined
  attemptedUserId: string | null
}): boolean =>
  detection === 'detected' &&
  userId !== '' &&
  accountFlags !== undefined &&
  !accountFlags.includes('extension_installed') &&
  attemptedUserId !== userId

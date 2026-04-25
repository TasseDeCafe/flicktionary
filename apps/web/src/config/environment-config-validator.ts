import { EnvironmentConfig } from '@/config/environment-config'
import { environmentConfigSchema } from '@/config/environment-config-schema'
import { logWithSentry } from '@/lib/analytics/log-with-sentry'

export const validateConfig = (config: EnvironmentConfig): void => {
  const parseResult = environmentConfigSchema.safeParse(config)

  if (!parseResult.success) {
    const errorMessages = parseResult.error.issues
      .map((issue) => `${issue.path.join('.')} - ${issue.message}`)
      .join(', ')

    logWithSentry({ message: `Environment Config Validation Error: ${errorMessages}` })
    throw new Error(`Environment Config Validation Error: ${errorMessages}`)
  }

  console.log(`Config for ${config.environmentName} environment validated successfully`)
}

import { getEnvironmentName, isProduction, SupportedEnvironments } from '../utils/environment-utils'
import { parseEmails } from './environment-config-utils'
import { EnvironmentConfig, environmentConfigSchema } from './environment-config-schema'
import { logMessageWithSentry } from '../transport/third-party/sentry/log-message-with-sentry'

export const validateConfig = (config: EnvironmentConfig): void => {
  if (!Object.values(SupportedEnvironments).includes(getEnvironmentName() as SupportedEnvironments)) {
    throw Error(`App run in non-supported environment: ${getEnvironmentName()}`)
  }
  const parseResult = environmentConfigSchema.safeParse(config)
  if (!parseResult.success) {
    const errorMessages = parseResult.error.issues
      .map((issue) => `${issue.path.join('.')} - ${issue.message}`)
      .join(', ')
    logMessageWithSentry(`Environment Config Validation Error: ${errorMessages}`)
  }
  // we'd like to be informed if we input non email values in doppler
  // using this inside production config validation was not possible, because it was creating a nasty circular dependency
  // more here: https://www.notion.so/grammarians/weird-double-usage-of-process-env-USERS_WITH_FREE_ACCESS-outside-of-config-objects-b6ef8011a74640e899f042f6444d41e3
  if (isProduction()) {
    const { invalidEmails } = parseEmails(process.env.USERS_WITH_FREE_ACCESS || '')
    if (invalidEmails.length > 0) {
      logMessageWithSentry(`Invalid emails: ${invalidEmails.join(',')}`)
    }
  }
  console.log('Environment Config validation success')
}

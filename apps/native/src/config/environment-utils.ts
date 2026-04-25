import { env } from '@/config/environment-config-schema'

enum SupportedEnvironments {
  PRODUCTION = 'production',
  DEVELOPMENT = 'development',
  TEST = 'test',
}

export const getModeName = (): string => {
  return env.EXPO_PUBLIC_APP_ENV
}

export const isProduction = (): boolean => {
  return getModeName() === SupportedEnvironments.PRODUCTION
}

export const isTest = (): boolean => {
  return getModeName() === SupportedEnvironments.TEST
}

export const isDevelopment = (): boolean => {
  return getModeName() === SupportedEnvironments.DEVELOPMENT
}

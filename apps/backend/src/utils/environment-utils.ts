export enum SupportedEnvironments {
  PRODUCTION = 'production',
  DEVELOPMENT = 'development',
  DEVELOPMENT_TUNNEL = 'development-tunnel',
  TEST = 'test',
  DEVELOPMENT_WITHOUT_THIRD_PARTIES = 'development-without-third-parties',
  DEVELOPMENT_WITHOUT_THIRD_PARTIES_TUNNEL = 'development-without-third-parties-tunnel',
}

export const isProduction = (): boolean => {
  return getEnvironmentName() === SupportedEnvironments.PRODUCTION
}

export const isDevelopment = (): boolean => {
  return getEnvironmentName() === SupportedEnvironments.DEVELOPMENT
}

export const isDevelopmentTunnel = (): boolean => {
  return getEnvironmentName() === SupportedEnvironments.DEVELOPMENT_TUNNEL
}

export const isTest = (): boolean => {
  return getEnvironmentName() === SupportedEnvironments.TEST
}

export const isDevelopmentWithoutThirdParties = (): boolean => {
  return getEnvironmentName() === SupportedEnvironments.DEVELOPMENT_WITHOUT_THIRD_PARTIES
}

export const isDevelopmentWithoutThirdPartiesTunnel = (): boolean => {
  return getEnvironmentName() === SupportedEnvironments.DEVELOPMENT_WITHOUT_THIRD_PARTIES_TUNNEL
}

export const getEnvironmentName = (): string | undefined => {
  return process.env.NODE_ENV
}

export const isProduction = (): boolean => {
  return !isDevelopmentTunnel() && getModeName() === 'production'
}

export const isTest = (): boolean => {
  return !isDevelopmentTunnel() && getModeName() === 'test'
}

export const isDevelopment = () => {
  return !isDevelopmentTunnel() && getModeName() === 'development'
}

export const isDevelopmentTunnel = () => {
  return process.env.NEXT_PUBLIC_IS_TUNNEL === 'true' && getModeName() === 'development'
}

export const getModeName = () => {
  return process.env.NODE_ENV
}

export const createPlainObjectHeaders = (requestHeaders: Headers): Record<string, string> => {
  const result: Record<string, string> = {}
  requestHeaders.forEach((value, key) => (result[key] = value))
  return result
}

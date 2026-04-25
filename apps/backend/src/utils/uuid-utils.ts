const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isInUuidFormat = (value: string): boolean => {
  return UUID_REGEX.test(value)
}

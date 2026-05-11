export const createResponseWithOneError = (errorMessage: string) => {
  return {
    errors: [{ message: errorMessage }],
  }
}

// postgres.js returns timestamptz columns as JS Date objects; oRPC output
// schemas generally expose timestamps as ISO strings. Normalize explicitly in
// DTO mappers instead of relying on JSON serialization order.
export const toIsoString = (value: string | Date | null): string | null => {
  if (value === null) return null
  if (value instanceof Date) return value.toISOString()
  return new Date(value).toISOString()
}

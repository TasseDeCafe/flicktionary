export const createResponseWithOneError = (errorMessage: string) => {
  return {
    errors: [{ message: errorMessage }],
  }
}

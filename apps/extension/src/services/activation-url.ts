// Pure matcher behind `PageConfig.activateAt` (see pages.ts): the regex is
// tested against `host + pathname` so one platform row can scope activation
// differently per host. Kept free of extension globals so it is unit-testable
// against the raw pages.json rows.
export const matchesActivationUrl = (activateAt: string | undefined, url: URL): boolean => {
  if (activateAt === undefined) {
    return true
  }
  return new RegExp(activateAt).test(`${url.host}${url.pathname}`)
}

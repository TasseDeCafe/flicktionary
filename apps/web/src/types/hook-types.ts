import '@tanstack/react-query'
import type { Register } from '@tanstack/react-query'

// Augment React Query's types to add custom meta fields
// See: https://github.com/TanStack/query/discussions/2772#discussioncomment-7566892
declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      showSuccessToast?: boolean
      showErrorToast?: boolean
      successMessage?: string
      errorMessage?: string
      showErrorModal?: boolean
    }
    queryMeta: {
      showErrorToast?: boolean
      errorMessage?: string
      showErrorModal?: boolean
    }
  }
}

// Export the augmented meta types for use in react-query-config.ts
// These are automatically picked up from the module augmentation above
export type QueryMeta = Register['queryMeta']

// Helper type to extract overrides accepted by ORPC mutationOptions helpers
// 1. Get the first parameter of mutationOptions
// 2. Make it non-nullable
// 3. Omit mutationFn so we can't override it
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OrpcMutationOverrides<T extends { mutationOptions: (...args: any[]) => any }> = Omit<
  NonNullable<Parameters<T['mutationOptions']>[0]>,
  'mutationFn'
>

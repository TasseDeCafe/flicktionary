export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'

export const CEFR_LEVELS: readonly CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']

// Short one-line descriptions used in the `CefrStep` OptionCards. Wrap with
// Lingui at the call site (these are intentionally English defaults; the step
// component runs them through `t\`\`` so they participate in extraction).
export const CEFR_LEVEL_DESCRIPTIONS: Record<CefrLevel, string> = {
  A1: 'Beginner — basic phrases and immediate needs.',
  A2: 'Elementary — simple, routine exchanges.',
  B1: 'Intermediate — handle most travel and everyday topics.',
  B2: 'Upper intermediate — fluent on familiar topics, some abstract ideas.',
  C1: 'Advanced — flexible, effective use in complex contexts.',
  C2: 'Mastery — virtually everything understood with ease.',
}

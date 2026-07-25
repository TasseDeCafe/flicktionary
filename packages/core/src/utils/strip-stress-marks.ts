// Russian display forms carry a combining acute (U+0301) marking stress
// (e.g. находи́ться). Card fronts strip it so the pronunciation isn't given
// away before the reveal. Display-only — do NOT use normalizeTargetForm for
// this (it also lowercases). NFC-composes first so orthographic acutes in
// decomposed input (NFD `été`, Vietnamese tone marks) render intact — only a
// U+0301 with no precomposed form (a stress mark) is stripped.
export const stripStressMarks = (text: string): string => text.normalize('NFC').replace(/́/g, '')

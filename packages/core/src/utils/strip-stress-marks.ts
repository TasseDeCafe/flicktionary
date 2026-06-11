// Russian display forms carry a combining acute (U+0301) marking stress
// (e.g. находи́ться). Card fronts strip it so the pronunciation isn't given
// away before the reveal. Display-only — do NOT use normalizeTargetForm for
// this (it also lowercases).
export const stripStressMarks = (text: string): string => text.replace(/́/g, '')

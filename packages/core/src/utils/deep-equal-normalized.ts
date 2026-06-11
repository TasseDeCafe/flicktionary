// "Absent" collapses null / undefined / blank string / empty array / objects
// whose every value is absent. Grounding writes only the keys kaikki had, the
// generate pass conditionally omits keys, and the grammar editors drop cleared
// keys — so absent-vs-absent must compare equal or untouched fields would show
// phantom "edited" pencils.
export const isAbsent = (v: unknown): boolean => {
  if (v === null || v === undefined) return true
  if (typeof v === 'string') return v.trim().length === 0
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).every(isAbsent)
  return false
}

// Structural equality with absence normalization + string trimming. Used to
// compare a live value against a stored source snapshot (grounding_patch,
// generated_payload) for provenance decisions — both client-side (per-field
// provenance icons) and server-side (the Wiktionary IPA badge on review terms).
export const deepEqualNormalized = (a: unknown, b: unknown): boolean => {
  const aAbsent = isAbsent(a)
  const bAbsent = isAbsent(b)
  if (aAbsent || bAbsent) return aAbsent === bAbsent
  if (typeof a === 'string' && typeof b === 'string') return a.trim() === b.trim()
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqualNormalized(item, b[i]))
  }
  if (
    typeof a === 'object' &&
    typeof b === 'object' &&
    a !== null &&
    b !== null &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    return [...keys].every((k) =>
      deepEqualNormalized((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
    )
  }
  return a === b
}

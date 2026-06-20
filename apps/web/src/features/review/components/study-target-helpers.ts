import { hasDisplayableIpa, type IpaBagShape } from '@flicktionary/core/utils/pick-ipa'
import type {
  Chunk,
  FacetSkill,
  Grammar,
  StudyFacetSummary,
} from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

// Which study target the unified editor is focused on. Citation drills the lemma
// (content on user_lookups); a form drills one inflection (content in the form
// facet's payload, keyed by the normalized target_form).
export type SelectedTarget = { kind: 'citation' } | { kind: 'form'; targetForm: string }

// One-shot signal from the "Add a form" sheet to the inline per-form editor: the
// user picked a form and chose how to fill it (Generate or Enter manually). The
// sheet creates the recognition facet and closes; the inline editor (which owns
// the loading state) runs the chosen action so the data loads on the main view.
export type FormAutoSetup = { targetForm: string; action: 'generate' | 'manual' }

// A form facet's display spelling — the payload `form` (stress/case intact),
// falling back to the normalized target_form key when the payload predates it.
export const formDisplay = (facet: StudyFacetSummary): string =>
  typeof facet.payload.form === 'string' && facet.payload.form.trim().length > 0
    ? (facet.payload.form as string)
    : facet.targetForm

// Skill preference for a form target's representative (content-anchor) facet:
// recognition (the historical base + the "Add a form" sheet's default), then
// production, then pronunciation. A form created for ANY single skill still
// resolves a representative, so a production-only exact-form save renders/edits.
const FORM_SKILL_PRIORITY: FacetSkill[] = ['meaning_recognition', 'meaning_production', 'pronunciation']

// The representative facet for a form target — the content anchor the focus-view
// form UI (chip, editor, skills card) keys on. Null when the form has no facets.
export const formTargetFacet = (facets: StudyFacetSummary[], targetForm: string): StudyFacetSummary | null => {
  for (const skill of FORM_SKILL_PRIORITY) {
    const found = facets.find((f) => f.skill === skill && f.targetForm === targetForm)
    if (found) return found
  }
  return null
}

// The form study targets, one representative facet per distinct form target_form.
// Keyed on ANY facet (not just recognition), so a form with only a
// production/pronunciation facet still gets a chip.
export const formTargets = (facets: StudyFacetSummary[]): StudyFacetSummary[] => {
  const targetForms = [...new Set(facets.filter((f) => f.targetForm !== '').map((f) => f.targetForm))]
  return targetForms
    .map((tf) => formTargetFacet(facets, tf))
    .filter((f): f is StudyFacetSummary => f !== null)
    .sort((a, b) => formDisplay(a).localeCompare(formDisplay(b)))
}

// Defensive string read of a form payload field (legacy `{form,translation}`
// rows and partial bags must not crash the editor).
export const payloadString = (payload: Record<string, unknown>, key: string): string =>
  typeof payload[key] === 'string' ? (payload[key] as string) : ''

// The form payload's grammar sub-bag (empty when absent). Read defensively — the
// payload is a lenient record on the wire.
export const payloadGrammar = (payload: Record<string, unknown>): Grammar =>
  payload.grammar && typeof payload.grammar === 'object' && !Array.isArray(payload.grammar)
    ? (payload.grammar as Grammar)
    : {}

// How many skills are enabled across all facets sharing a target_form. Zero =
// the "dormant" state (in vocabulary, queued nowhere) — the chip renders muted.
export const enabledSkillCount = (facets: StudyFacetSummary[], targetForm: string): number =>
  facets.filter((f) => f.targetForm === targetForm && f.enabled).length

// The three studiable skills as the UI names them, mapped to their facet skill.
export type LiveSkillKey = 'recognition' | 'production' | 'pronunciation'
const FACET_OF: Record<LiveSkillKey, FacetSkill> = {
  recognition: 'meaning_recognition',
  production: 'meaning_production',
  pronunciation: 'pronunciation',
}

// One live-facet skill toggle, resolved against the term's current facets. The
// single source of truth for the toggle/payload/IPA-availability logic shared by
// the focus view's SkillsCard, the reader's saved gloss sheet, and (mirrored in
// its own messaging) the extension. `locked` is the UI last-skill lock — the
// friendly front for the backend floor guard: a KEPT term must always keep ≥1
// enabled skill per target, so its last enabled skill can't be toggled off here.
export type LiveSkillItem = {
  key: LiveSkillKey
  enabled: boolean
  available: boolean
  unavailableHint?: string
  locked: boolean
  toggle: () => void
}

export type SetFacetEnabledFn = (args: {
  chunkId: string
  skill: FacetSkill
  targetForm: string
  enabled: boolean
  payload?: Record<string, unknown>
}) => void

const facetIpaBag = (facet: StudyFacetSummary | undefined): IpaBagShape | null => {
  const grammar = facet?.payload.grammar
  return grammar && typeof grammar === 'object'
    ? (((grammar as Record<string, unknown>).ipa ?? null) as IpaBagShape | null)
    : null
}

// Build the live skill toggles for the selected target. Replicates the
// citation/form payload-reuse rules (a second skill on a filled form is born
// ready; a copied meaning payload never flips pronunciation ready) so every
// surface toggles facets identically. `isKept` gates the last-skill lock —
// pre-keep terms keep their freedom to drop to zero facets (the backend guard
// only enforces the floor on kept terms).
export const buildLiveSkillItems = ({
  chunk,
  facets,
  selectedTarget,
  isKept,
  setFacetEnabled,
  noIpaHint,
}: {
  chunk: Chunk
  facets: StudyFacetSummary[]
  selectedTarget: SelectedTarget
  isKept: boolean
  setFacetEnabled: SetFacetEnabledFn
  noIpaHint: string
}): LiveSkillItem[] => {
  const targetForm = selectedTarget.kind === 'form' ? selectedTarget.targetForm : ''
  const enabledCount = enabledSkillCount(facets, targetForm)
  const isOnly = (enabled: boolean) => isKept && enabled && enabledCount === 1
  const enabledOf = (key: LiveSkillKey) =>
    facets.some((f) => f.skill === FACET_OF[key] && f.targetForm === targetForm && f.enabled)

  if (selectedTarget.kind === 'citation') {
    const ipaAvailable = hasDisplayableIpa((chunk.grammar?.ipa ?? null) as IpaBagShape | null, chunk.targetLanguage)
    const recognitionOn = enabledOf('recognition')
    const productionOn = enabledOf('production')
    const pronunciationOn = enabledOf('pronunciation')
    return [
      {
        key: 'recognition',
        enabled: recognitionOn,
        available: true,
        locked: isOnly(recognitionOn),
        toggle: () =>
          setFacetEnabled({ chunkId: chunk.id, skill: 'meaning_recognition', targetForm: '', enabled: !recognitionOn }),
      },
      {
        key: 'production',
        enabled: productionOn,
        available: true,
        locked: isOnly(productionOn),
        toggle: () =>
          setFacetEnabled({ chunkId: chunk.id, skill: 'meaning_production', targetForm: '', enabled: !productionOn }),
      },
      {
        key: 'pronunciation',
        enabled: pronunciationOn,
        available: ipaAvailable,
        unavailableHint: ipaAvailable ? undefined : noIpaHint,
        locked: isOnly(pronunciationOn),
        toggle: () =>
          setFacetEnabled({ chunkId: chunk.id, skill: 'pronunciation', targetForm: '', enabled: !pronunciationOn }),
      },
    ]
  }

  const recognitionFacet = facets.find((f) => f.skill === 'meaning_recognition' && f.targetForm === targetForm)
  const productionFacet = facets.find((f) => f.skill === 'meaning_production' && f.targetForm === targetForm)
  const pronunciationFacet = facets.find((f) => f.skill === 'pronunciation' && f.targetForm === targetForm)
  const recognitionOn = !!recognitionFacet?.enabled
  const productionOn = !!productionFacet?.enabled
  const pronunciationOn = !!pronunciationFacet?.enabled
  // Content anchor for the form — whichever facet already carries its card data
  // (a form may have no recognition facet, e.g. a production-only exact-form
  // save). Enabling a new skill reuses this payload so the new facet is born
  // ready instead of pending_data.
  const contentFacet = formTargetFacet(facets, targetForm)
  const contentPayload = contentFacet?.payload
  const form = contentFacet ? formDisplay(contentFacet) : targetForm
  // A facet whose payload already carries the form's own IPA: enabling
  // pronunciation with that payload makes the facet born ready (no regeneration).
  const ipaSibling = facets
    .filter((f) => f.targetForm === targetForm)
    .find((f) => hasDisplayableIpa(facetIpaBag(f), chunk.targetLanguage))
  return [
    {
      key: 'recognition',
      enabled: recognitionOn,
      available: true,
      locked: isOnly(recognitionOn),
      toggle: () =>
        setFacetEnabled({
          chunkId: chunk.id,
          skill: 'meaning_recognition',
          targetForm,
          enabled: !recognitionOn,
          payload: !recognitionOn ? (contentPayload ?? { form }) : undefined,
        }),
    },
    {
      key: 'production',
      enabled: productionOn,
      available: true,
      locked: isOnly(productionOn),
      toggle: () =>
        setFacetEnabled({
          chunkId: chunk.id,
          skill: 'meaning_production',
          targetForm,
          enabled: !productionOn,
          payload: !productionOn ? (contentPayload ?? { form }) : undefined,
        }),
    },
    {
      key: 'pronunciation',
      enabled: pronunciationOn,
      available: true,
      locked: isOnly(pronunciationOn),
      toggle: () =>
        setFacetEnabled({
          chunkId: chunk.id,
          skill: 'pronunciation',
          targetForm,
          enabled: !pronunciationOn,
          payload: !pronunciationOn ? (ipaSibling ? ipaSibling.payload : { form }) : undefined,
        }),
    },
  ]
}

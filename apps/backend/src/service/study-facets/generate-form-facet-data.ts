import { hasDisplayableIpa, type IpaBagShape } from '@flicktionary/core/utils/pick-ipa'
import { logCustomErrorMessageAndError } from '../../transport/error-monitoring/error-monitoring'
import { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { FacetSkill } from '../../transport/database/study-facets/study-facets-repository'
import { getIpaDialectForTargetLanguage } from '../user-prefs/ipa-dialect'
import { getLanguageMode } from '../user-prefs/language-mode'

import type { AnthropicPassesInterface } from '../../transport/third-party/anthropic/anthropic-passes'

export type GenerateFormFacetDataDeps = {
  anthropicPasses: AnthropicPassesInterface
  userLookupsRepository: UserLookupsRepositoryInterface
  usersRepository: UsersRepositoryInterface
  userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface
}

export type GenerateFormFacetDataOutcome = 'generated' | 'skipped' | 'failed'

// Server side of generate-and-confirm: fill a pending_data form facet's payload
// from the encountered surface form via the Opus pass, then flip it to 'ready'
// (setFacetPayload) so the queue serves it. Synchronous (user-initiated from the
// term view, behind a spinner) — there is no background-job precedent for
// per-form data, and the user is waiting to see/confirm the result anyway.
//
// `skipped` = the facet or term vanished (idempotent no-op); `failed` = the Opus
// call threw, OR a pronunciation facet's generation came back without a
// confident per-form IPA (the facet stays pending_data either way — the chip
// keeps offering retry / manual entry). When translations are off for this
// language there is nothing to translate, so we mark ready with the bare
// surface form, no model call — EXCEPT pronunciation, which always runs the
// model (the form's IPA is the whole point of the facet).
export const generateFormFacetData = async (
  params: {
    chunkId: string
    userId: string
    skill: FacetSkill
    targetForm: string
    // Caller-supplied encountered sentence. The default below reads the facet's
    // source join, which only sees the most-recent KEPT card — at study-intent
    // time (enrichment / pre-keep adhoc) the card is still pending, so the join
    // misses and Opus would invent an example. Intent callers know the real
    // segment text and pass it here; `undefined` keeps the facet-derived lookup.
    encounteredSentence?: string | null
  },
  deps: GenerateFormFacetDataDeps
): Promise<GenerateFormFacetDataOutcome> => {
  try {
    const term = await deps.userLookupsRepository.getChunkRowForUser(params.chunkId, params.userId)
    if (!term) return 'skipped'

    const facets = await deps.userLookupsRepository.listFacetsForChunk(params.chunkId)
    const target = facets.find((f) => f.skill === params.skill && f.targetForm === params.targetForm)
    if (!target) return 'skipped'

    // The display form seeded at enable time; fall back to the normalized key.
    const surfaceForm =
      typeof target.payload.form === 'string' && target.payload.form.trim().length > 0
        ? (target.payload.form as string)
        : params.targetForm

    // The real sentence the learner met this form in, passed to Opus as context
    // for the form's sense and register. Opus writes a fresh standalone example;
    // it does not copy this verbatim (raw segments can be whole paragraphs).
    const encounteredSentence =
      params.encounteredSentence !== undefined ? params.encounteredSentence : (target.source?.sentence ?? null)

    const languageMode = await getLanguageMode({
      userId: params.userId,
      targetLanguage: term.targetLanguage,
      usersRepository: deps.usersRepository,
      targetLanguagePrefsRepository: deps.userTargetLanguagePrefsRepository,
    })

    const isPronunciation = params.skill === 'pronunciation'

    if (languageMode.hideTranslationFields && !isPronunciation) {
      // Nothing to translate, so no model call — mark ready with the bare form
      // and (when known) the encountered sentence as its target-language example.
      // The payload doubles as the generated_payload provenance snapshot.
      // Pronunciation never takes this shortcut: its render data is the form's
      // IPA, which only the model call produces.
      const barePayload = {
        form: surfaceForm,
        translation: '',
        ...(encounteredSentence ? { targetExample: encounteredSentence } : {}),
      }
      await deps.userLookupsRepository.setFacetPayload({
        userLookupId: params.chunkId,
        userId: params.userId,
        skill: params.skill,
        targetForm: params.targetForm,
        payload: barePayload,
        generatedPayload: barePayload,
      })
      return 'generated'
    }

    // Form IPA follows the user's dialect preference for dialect-split
    // languages; other languages get the shared untagged bucket.
    const ipaDialect = await getIpaDialectForTargetLanguage(deps.usersRepository, params.userId, term.targetLanguage)

    const result = await deps.anthropicPasses.generateFormData({
      nativeLanguage: languageMode.nativeLanguage ?? term.targetLanguage,
      targetLanguage: term.targetLanguage,
      headword: term.headword,
      headwordTranslation: term.translation,
      surfaceForm,
      encounteredSentence,
      ipaDialect,
    })

    // The form's own IPA goes into the payload's grammar bag in GrammarIpaBag
    // shape — resolve-card-content reads facetPayload.grammar.ipa (deliberately
    // no lemma fallback: a lemma's transcription is wrong for an inflection).
    const ipaBag: IpaBagShape | null = result.ipa ? { [ipaDialect ?? 'untagged']: result.ipa } : null

    // Readiness guard: a pronunciation facet with no confident generated IPA
    // must NOT flip to ready (setFacetPayload flips unconditionally) — leave it
    // pending_data so the retry chip / manual entry path takes over.
    if (isPronunciation && !hasDisplayableIpa(ipaBag, term.targetLanguage)) {
      return 'failed'
    }

    // Forward the full generated content. `grammar` is written as a complete
    // object (pos + the form's ipa) — the shallow JSONB merge replaces the whole
    // grammar sub-bag, which is correct since a freshly-generated form has none.
    // The same object is stored as the generated_payload provenance snapshot:
    // per-field provenance compares the live payload against it. Translation
    // fields are blanked when the language hides them (the pronunciation path
    // can reach here with translations off).
    const hideTranslations = languageMode.hideTranslationFields
    const grammar = {
      ...(result.pos ? { pos: result.pos } : {}),
      // Stress-marked display form so the form's grammar matches the lemma's
      // (Russian stress lives here as well as in payload.form). Null for
      // languages that don't use one (e.g. English).
      ...(result.displayForm ? { display_form: result.displayForm } : {}),
      ...(ipaBag ? { ipa: ipaBag } : {}),
    }
    const generatedPayload = {
      form: result.form,
      translation: hideTranslations ? '' : result.translation,
      ...(result.definition ? { definition: result.definition } : {}),
      ...(result.targetExample ? { targetExample: result.targetExample } : {}),
      ...(!hideTranslations && result.nativeExample ? { nativeExample: result.nativeExample } : {}),
      ...(Object.keys(grammar).length > 0 ? { grammar } : {}),
    }
    await deps.userLookupsRepository.setFacetPayload({
      userLookupId: params.chunkId,
      userId: params.userId,
      skill: params.skill,
      targetForm: params.targetForm,
      payload: generatedPayload,
      generatedPayload,
    })
    return 'generated'
  } catch (e) {
    logCustomErrorMessageAndError(
      `generateFormFacetData failed, chunkId = ${params.chunkId}, targetForm = ${params.targetForm}`,
      e
    )
    return 'failed'
  }
}

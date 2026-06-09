import { logCustomErrorMessageAndError } from '../../transport/third-party/sentry/error-monitoring'
import { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { FacetSkill } from '../../transport/database/study-facets/study-facets-repository'
import { generateFormData } from '../../transport/third-party/anthropic/passes/generate-form-data'
import { getLanguageMode } from '../user-prefs/language-mode'

export type GenerateFormFacetDataDeps = {
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
// call threw (the facet stays pending_data, the chip keeps offering retry /
// manual entry). When translations are off for this language there is nothing to
// translate, so we mark ready with the bare surface form, no model call.
export const generateFormFacetData = async (
  params: { chunkId: string; userId: string; skill: FacetSkill; targetForm: string },
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

    const languageMode = await getLanguageMode({
      userId: params.userId,
      targetLanguage: term.targetLanguage,
      usersRepository: deps.usersRepository,
      targetLanguagePrefsRepository: deps.userTargetLanguagePrefsRepository,
    })

    if (languageMode.hideTranslationFields) {
      await deps.userLookupsRepository.setFacetPayload({
        userLookupId: params.chunkId,
        userId: params.userId,
        skill: params.skill,
        targetForm: params.targetForm,
        payload: { form: surfaceForm, translation: '' },
      })
      return 'generated'
    }

    const result = await generateFormData({
      nativeLanguage: languageMode.nativeLanguage ?? term.targetLanguage,
      targetLanguage: term.targetLanguage,
      headword: term.headword,
      headwordTranslation: term.translation,
      surfaceForm,
    })

    await deps.userLookupsRepository.setFacetPayload({
      userLookupId: params.chunkId,
      userId: params.userId,
      skill: params.skill,
      targetForm: params.targetForm,
      payload: { form: result.form, translation: result.translation },
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

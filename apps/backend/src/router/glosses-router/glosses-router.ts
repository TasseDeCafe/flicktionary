import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { glossesContract } from '@flicktionary/api-client/orpc-contracts/glosses-contract'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import type { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import type { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import type { WiktionaryEntriesRepositoryInterface } from '../../transport/database/wiktionary-entries/wiktionary-entries-repository'
import type { AnthropicPassesInterface } from '../../transport/third-party/anthropic/anthropic-passes'
import { getLanguageMode } from '../../service/user-prefs/language-mode'
import { lookupFastGlossIpa } from '../../service/wiktionary-grounding/fast-gloss-ipa'
import { pickIpa } from '@flicktionary/core/utils/pick-ipa'

// Stateless gloss lookups (browser-extension subtitle hover, the web app's
// practice-surface lookup sheet). Takes the context line directly and is bound
// to no highlight or practice_text — nothing is persisted.
export const GlossesRouter = (
  usersRepository: UsersRepositoryInterface,
  userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface,
  wiktionaryEntriesRepository: WiktionaryEntriesRepositoryInterface,
  anthropicPasses: AnthropicPassesInterface
): Router => {
  const implementer = implement(glossesContract).$context<OrpcContext>().use(errorBoundaryMiddleware)

  const router = implementer.router({
    fastGloss: implementer.fastGloss.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      // The target language IS the language of the text being glossed. When the
      // client doesn't supply it (it hasn't learned the subtitle language yet),
      // detect it from the context line — never fall back to the user's primary
      // study language, which is wrong for a video in a different language.
      const targetLanguage = input.targetLanguage ?? (await anthropicPasses.languageDetectionPass(input.contextLine))
      if (!targetLanguage) {
        throw errors.BAD_REQUEST({ data: { errors: [{ message: 'Could not detect the language of this text.' }] } })
      }
      const languagePrefs = await getLanguageMode({
        userId,
        targetLanguage,
        usersRepository,
        targetLanguagePrefsRepository: userTargetLanguagePrefsRepository,
      })
      if (!languagePrefs.nativeLanguage) {
        throw errors.BAD_REQUEST({ data: { errors: [{ message: 'Native language not set' }] } })
      }
      const gloss = await anthropicPasses.fastGlossPass({
        targetLanguage,
        nativeLanguage: languagePrefs.nativeLanguage,
        hideTranslationFields: languagePrefs.hideTranslationFields,
        contextLine: input.contextLine,
        selectionText: input.selectionText,
      })
      const ipaResult = await lookupFastGlossIpa({
        targetLanguage,
        selectionText: input.selectionText,
        pos: gloss.pos,
        wiktionaryEntriesRepository,
      })
      const ipa = ipaResult?.ipa ?? null
      // Pre-pick the dialect-correct display string server-side so every
      // client renders the same IPA. The dialect pref only matters for
      // English; skip the DB roundtrip otherwise.
      const dialect = targetLanguage === 'en' ? await usersRepository.getEnglishIpaDialect(userId) : 'ga'
      return {
        data: {
          ...gloss,
          ipa,
          ipaDisplay: pickIpa(ipa, targetLanguage, dialect) ?? null,
          ipaLemma: ipaResult?.lemma ?? null,
        },
      }
    }),
  })

  return createOrpcExpressRouter(router, { contract: glossesContract })
}

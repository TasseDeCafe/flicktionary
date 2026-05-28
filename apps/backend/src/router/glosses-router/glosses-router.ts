import { Router } from 'express'
import { implement } from '@orpc/server'
import { createOrpcExpressRouter } from '../orpc/helpers/create-orpc-express-router'
import { type OrpcContext } from '../orpc/orpc-context'
import { glossesContract } from '@flicktionary/api-client/orpc-contracts/glosses-contract'
import { errorBoundaryMiddleware } from '../orpc/helpers/error-boundary-middleware'
import type { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import type { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import type { WiktionaryEntriesRepositoryInterface } from '../../transport/database/wiktionary-entries/wiktionary-entries-repository'
import { fastGlossPass } from '../../transport/third-party/anthropic/passes/fast-gloss-pass'
import { getLanguageMode } from '../../service/user-prefs/language-mode'
import { lookupFastGlossIpa } from '../../service/wiktionary-grounding/fast-gloss-ipa'

// Stateless gloss lookups (browser-extension subtitle hover). Mirrors the
// practice.fastGloss handler but takes the context line directly and is bound
// to no highlight or practice_text — nothing is persisted.
export const GlossesRouter = (
  usersRepository: UsersRepositoryInterface,
  userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface,
  wiktionaryEntriesRepository: WiktionaryEntriesRepositoryInterface
): Router => {
  const implementer = implement(glossesContract).$context<OrpcContext>().use(errorBoundaryMiddleware)

  const router = implementer.router({
    fastGloss: implementer.fastGloss.handler(async ({ input, context, errors }) => {
      const userId = context.res.locals.userId
      const languagePrefs = await getLanguageMode({
        userId,
        targetLanguage: input.targetLanguage,
        usersRepository,
        targetLanguagePrefsRepository: userTargetLanguagePrefsRepository,
      })
      if (!languagePrefs.nativeLanguage) {
        throw errors.BAD_REQUEST({ data: { errors: [{ message: 'Native language not set' }] } })
      }
      const gloss = await fastGlossPass({
        targetLanguage: input.targetLanguage,
        nativeLanguage: languagePrefs.nativeLanguage,
        hideTranslationFields: languagePrefs.hideTranslationFields,
        contextLine: input.contextLine,
        selectionText: input.selectionText,
      })
      const ipa = await lookupFastGlossIpa({
        targetLanguage: input.targetLanguage,
        selectionText: input.selectionText,
        pos: gloss.pos,
        wiktionaryEntriesRepository,
      })
      return { data: { ...gloss, ipa } }
    }),
  })

  return createOrpcExpressRouter(router, { contract: glossesContract })
}

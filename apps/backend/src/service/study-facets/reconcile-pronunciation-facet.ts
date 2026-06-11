import { hasDisplayableIpa, type IpaBagShape } from '@flicktionary/core/utils/pick-ipa'
import { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'

// Keep the citation pronunciation facet in sync with the term's IPA precondition
// (Trap 12). A pronunciation card derives its back from grammar.ipa at render;
// if no transcription is displayable the card is empty and there is nothing to
// rehab, so the facet is DELETED (not disabled — decided). Self-healing: run
// after grammar edits (IPA can vanish) and after a pronunciation enable (defends
// an enable on a term that never had IPA). DELETE is a no-op when no such facet
// exists, so this is safe to call unconditionally.
export const reconcilePronunciationFacet = async (
  userLookupsRepository: UserLookupsRepositoryInterface,
  chunkId: string,
  grammar: Record<string, unknown>,
  targetLanguage: string
): Promise<void> => {
  const ipa = (grammar?.ipa ?? null) as IpaBagShape | null
  if (!hasDisplayableIpa(ipa, targetLanguage)) {
    await userLookupsRepository.deleteFacet({ userLookupId: chunkId, skill: 'pronunciation', targetForm: '' })
  }
}

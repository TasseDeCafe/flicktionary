import { useLingui } from '@lingui/react/macro'
import { BadgeCheck, Volume2 } from 'lucide-react'
import { EnglishIpaDialectFlag } from '@/components/english-ipa-dialect-flag'
import { GrammarChips } from '@/features/review/components/grammar-chips'
import { useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import { getShowTranslationsEnabledForLanguage } from '@/features/sessions/utils/show-translations-pref'
import { pickIpaForDisplay } from '@flicktionary/core/utils/pick-ipa'
import { stripStressMarks } from '@flicktionary/core/utils/strip-stress-marks'
import {
  getCardFaceConfig,
  resolveCardSlots,
  type CardSlotConditions,
  type CardSlotKey,
} from '@flicktionary/core/constants/card-face-config'
import type {
  Grammar,
  PracticePool,
  ReviewTerm,
} from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { resolveCardContent } from '../utils/resolve-card-content'

// The pool a queued card belongs to is fully determined by its facet skill —
// the composed queue mixes pools in one session, so it can't be a view-level
// constant anymore.
export const poolForCard = (card: ReviewTerm): PracticePool =>
  card.skill === 'meaning_production' ? 'production' : 'recognition'

// Presentational flashcard body (front, and the back when `showBack`):
// pronunciation cards get their dedicated audio-cue layout, meaning cards go
// through the declarative slot resolver. Pure render — revealing, rating, and
// queue movement live in the owning view.
export const FlashcardFace = ({
  card,
  targetLanguage,
  showBack,
}: {
  card: ReviewTerm
  targetLanguage: string
  showBack: boolean
}) => {
  const { t } = useLingui()
  const { data: userPrefs } = useGetUserPrefs()
  const pool = poolForCard(card)

  const nativeLanguage = userPrefs?.nativeLanguage ?? null
  const sameLanguage = !!nativeLanguage && nativeLanguage.trim().toLowerCase() === targetLanguage.trim().toLowerCase()
  const hideTranslationFields = sameLanguage || !getShowTranslationsEnabledForLanguage(userPrefs, targetLanguage)
  const englishIpaDialect = userPrefs?.englishIpaDialect ?? 'ga'

  // Pronunciation facet (recognition queue): front prompts the target + an
  // audio cue ("say it out loud"), the flip reveals the stressed display form
  // + IPA. Distinct enough from the meaning layouts (no slot resolver, its own
  // audio chip) that it gets a dedicated body. Form-aware: a form card reads
  // its own facetPayload (display + IPA — deliberately no lemma fallback, a
  // lemma's transcription is wrong for an inflection); citation reads the
  // lemma row. The IPA falls back across dialects so a card that passed the
  // readiness gate never reveals an empty back (the citation IPA-vanished case
  // is handled server-side by deleting the facet — see
  // reconcilePronunciationFacet; a form facet without IPA never reaches ready).
  const isPronunciation = card.skill === 'pronunciation'
  const isFormCard = card.targetForm !== ''
  const facetPayload = (card.facetPayload ?? {}) as Record<string, unknown>
  const formGrammar: Grammar =
    facetPayload.grammar && typeof facetPayload.grammar === 'object' && !Array.isArray(facetPayload.grammar)
      ? (facetPayload.grammar as Grammar)
      : {}
  const pronunciationDisplay =
    isFormCard && typeof facetPayload.form === 'string'
      ? formGrammar.display_form || facetPayload.form
      : card.grammar?.display_form || card.headword
  const pronunciationIpa = isPronunciation
    ? isFormCard
      ? pickIpaForDisplay(formGrammar.ipa, targetLanguage, englishIpaDialect)
      : pickIpaForDisplay(card.grammar?.ipa, targetLanguage, englishIpaDialect)
    : undefined
  // Blue check next to the IPA when the transcription is dictionary-grounded
  // (citation cards only — ipaSource is computed server-side and always null
  // for forms, whose IPA is generated).
  const ipaBadge =
    card.ipaSource === 'wiktionary' ? (
      <span title={t`Verified by Wiktionary`} aria-label={t`Verified by Wiktionary`}>
        <BadgeCheck className='h-3.5 w-3.5 text-sky-600' />
      </span>
    ) : null

  // A queued card whose target_form is a specific inflection carries its OWN
  // full card content in facetPayload (translation / definition / examples /
  // grammar). resolveCardContent prefers that per field and falls back to the
  // lemma where the form is silent — except IPA, which never falls back (a
  // lemma's transcription is wrong for an inflection). The form swaps into the
  // 'headword' slot (front on recognition, back on production) and the lemma is
  // demoted to a secondary line on the back. Citation cards resolve to the lemma.
  const content = resolveCardContent(card, targetLanguage, englishIpaDialect)

  const cond: CardSlotConditions = {
    hideTranslationFields,
    hasIpa: !!content.ipa,
    hasTargetExample: !!content.targetExample,
    hasNativeExample: !!content.nativeExample,
    hasTranslation: !!content.translation,
    hasDefinition: !!content.definition,
    hasGrammarChips: !!content.grammar,
  }

  // Production fronts are gloss-only; a card with no translation, no
  // definition and no example translation would render a blank front — fall
  // back to the recognition layout for that card.
  const poolConfig = getCardFaceConfig(targetLanguage, pool)
  const poolFront = resolveCardSlots(poolConfig.front, cond)
  const faceConfig = poolFront.length > 0 ? poolConfig : getCardFaceConfig(targetLanguage, 'recognition')
  const frontSlots = poolFront.length > 0 ? poolFront : resolveCardSlots(faceConfig.front, cond)
  const backSlots = resolveCardSlots(faceConfig.back, cond)

  const renderSlot = (slot: CardSlotKey, face: 'front' | 'back') => {
    switch (slot) {
      case 'headword': {
        const fullForm = content.displayForm
        return (
          <div key='headword' className='flex flex-col items-center gap-1'>
            <span lang={targetLanguage} className='text-2xl font-bold'>
              {faceConfig.hideStressOnFront && !showBack ? stripStressMarks(fullForm) : fullForm}
            </span>
            {content.citationForms && (
              <span lang={targetLanguage} className='text-muted-foreground text-base'>
                {content.citationForms}
              </span>
            )}
          </div>
        )
      }
      case 'ipa':
        return content.ipa ? (
          <div key='ipa' className='text-muted-foreground flex items-center justify-center gap-1.5 text-base'>
            <EnglishIpaDialectFlag targetLanguage={targetLanguage} englishIpaDialect={englishIpaDialect} />
            <span>{content.ipa}</span>
            {ipaBadge}
          </div>
        ) : null
      case 'targetExample':
        return content.targetExample ? (
          <p key='targetExample' className='border-l-2 border-yellow-300 pl-3 text-left text-base'>
            {content.targetExample}
          </p>
        ) : null
      case 'nativeExample':
        return content.nativeExample ? (
          <p key='nativeExample' className='text-muted-foreground pl-3 text-left text-base'>
            {content.nativeExample}
          </p>
        ) : null
      case 'translation': {
        return content.translation ? (
          <p key='translation' className='text-lg'>
            {content.translation}
          </p>
        ) : null
      }
      case 'definition':
        // On an active front the definition is the prompt itself (translation
        // fallback), so it gets prompt sizing instead of footnote sizing.
        return content.definition ? (
          <p key='definition' className={face === 'front' ? 'text-lg' : 'text-muted-foreground text-sm'}>
            {content.definition}
          </p>
        ) : null
      case 'grammar':
        return (
          <div key='grammar' className='flex justify-center'>
            <GrammarChips grammar={content.grammar} targetLanguage={targetLanguage} />
          </div>
        )
      default:
        return null
    }
  }

  if (isPronunciation) {
    return (
      <>
        {/* Front: bare target (ru stress hidden so the answer isn't given
            away) + an audio cue. Audio playback is roadmap; the chip is the
            "pronounce this" prompt, not a player. */}
        <span lang={targetLanguage} className='text-2xl font-bold'>
          {stripStressMarks(pronunciationDisplay)}
        </span>
        <div className='text-muted-foreground flex items-center gap-1.5 text-sm'>
          <Volume2 className='h-4 w-4' />
          <span>{t`Say it out loud`}</span>
        </div>
        {showBack && (
          <>
            <div className='my-2 w-full border-t' />
            {/* Back: stressed display form + IPA. */}
            <span lang={targetLanguage} className='text-2xl font-bold'>
              {pronunciationDisplay}
            </span>
            {pronunciationIpa && (
              <div className='text-muted-foreground flex items-center justify-center gap-1.5 text-base'>
                <EnglishIpaDialectFlag targetLanguage={targetLanguage} englishIpaDialect={englishIpaDialect} />
                <span>{pronunciationIpa}</span>
                {ipaBadge}
              </div>
            )}
          </>
        )}
      </>
    )
  }

  return (
    <>
      {frontSlots.map((slot) => renderSlot(slot, 'front'))}
      {showBack && (
        <>
          <div className='my-2 w-full border-t' />
          {content.lemma && (
            <p className='text-muted-foreground text-sm'>
              <span lang={targetLanguage} className='font-medium'>
                {content.lemma.displayForm}
              </span>
              {content.lemma.translation ? ` — ${content.lemma.translation}` : null}
            </p>
          )}
          {backSlots.map((slot) => renderSlot(slot, 'back'))}
        </>
      )}
    </>
  )
}

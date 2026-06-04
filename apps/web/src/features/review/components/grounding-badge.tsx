import { useLingui } from '@lingui/react/macro'
import { Badge } from '@flicktionary/ui/components/badge'
import { KAIKKI_LANGUAGES } from '@flicktionary/core/constants/language-grammar'

type Props = {
  groundedAt: string | null
  grammarUserEditedAt: string | null
  targetLanguage: string | undefined
}

// Card-level provenance signal for the focus view's grammar facts. Only
// rendered when the session's target language has a kaikki dump loaded
// (otherwise the absence of grounding is the default state and a badge would
// just be noise). User edits get their own state so the badge doesn't imply
// the current values are still exactly machine-produced.
export const GroundingBadge = ({ groundedAt, grammarUserEditedAt, targetLanguage }: Props) => {
  const { t } = useLingui()
  if (!targetLanguage || !KAIKKI_LANGUAGES.has(targetLanguage)) return null

  if (groundedAt && grammarUserEditedAt) {
    const groundedDate = new Date(groundedAt).toLocaleDateString()
    return (
      <Badge variant='outline' title={t`Originally verified against Wiktionary on ${groundedDate}, then edited`}>
        {t`Wiktionary, edited`}
      </Badge>
    )
  }

  if (groundedAt) {
    const groundedDate = new Date(groundedAt).toLocaleDateString()
    return (
      <Badge variant='secondary' title={t`Verified against Wiktionary on ${groundedDate}`}>
        {t`✓ Wiktionary`}
      </Badge>
    )
  }

  if (grammarUserEditedAt) {
    return (
      <Badge variant='outline' title={t`Grammar fields have been edited manually`}>
        {t`Edited`}
      </Badge>
    )
  }

  return (
    <Badge variant='outline' title={t`Not found in Wiktionary — grammar fields are LLM-generated only`}>
      {t`⚠ LLM only`}
    </Badge>
  )
}

import { useLingui } from '@lingui/react/macro'
import { Badge } from '@/components/ui/badge'
import { KAIKKI_LANGUAGES } from '@flicktionary/core/constants/language-grammar'

type Props = {
  groundedAt: string | null
  targetLanguage: string | undefined
}

// Card-level provenance signal for the focus view's grammar facts. Only
// rendered when the session's target language has a kaikki dump loaded
// (otherwise the absence of grounding is the default state and a badge would
// just be noise). Persists across user edits — the badge reflects "kaikki was
// consulted at processing time", not whether the current value is unedited.
export const GroundingBadge = ({ groundedAt, targetLanguage }: Props) => {
  const { t } = useLingui()
  if (!targetLanguage || !KAIKKI_LANGUAGES.has(targetLanguage)) return null

  if (groundedAt) {
    const groundedDate = new Date(groundedAt).toLocaleDateString()
    return (
      <Badge variant='secondary' title={t`Verified against Wiktionary on ${groundedDate}`}>
        {t`✓ Wiktionary`}
      </Badge>
    )
  }

  return (
    <Badge variant='outline' title={t`Not found in Wiktionary — grammar fields are LLM-generated only`}>
      {t`⚠ LLM only`}
    </Badge>
  )
}

import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { Button } from '@flicktionary/ui/components/button'
import {
  ResponsiveOverlay,
  OverlayContent,
  OverlayDescription,
  OverlayHeader,
  OverlayTitle,
} from '@/components/ui/responsive-overlay'
import { CefrStep } from './cefr-step'
import type { CefrLevel } from '../constants/cefr'

type Props = {
  open: boolean
  targetLanguage: string
  isSubmitting?: boolean
  onSubmit: (level: CefrLevel) => void
  onCancel: () => void
}

// The standalone CEFR ask for flows without a wizard step to host CefrStep —
// e.g. adding shared content in a language the user has no prefs row for yet.
// Same OptionCard body as the wizards, so the choice looks identical wherever
// it is made.
export const CefrPromptDialog = ({ open, targetLanguage, isSubmitting, onSubmit, onCancel }: Props) => {
  const { t } = useLingui()
  const [level, setLevel] = useState<CefrLevel | null>(null)
  const languageName = getLanguageName(targetLanguage)

  return (
    <ResponsiveOverlay
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <OverlayContent className='h-[85svh] sm:h-auto sm:max-h-[80vh] sm:max-w-md sm:overflow-y-auto'>
        <OverlayHeader>
          {/* CefrStep renders the visible heading; the overlay title is for
              the accessibility tree only. */}
          <OverlayTitle className='sr-only'>{t`Your level in ${languageName}`}</OverlayTitle>
          <OverlayDescription className='sr-only'>
            {t`Pick your level so content and explanations match it.`}
          </OverlayDescription>
        </OverlayHeader>
        <div className='flex flex-col gap-4 overflow-y-auto px-4 pb-4'>
          <CefrStep targetLanguage={targetLanguage} value={level} onChange={setLevel} />
          <Button
            size='xl'
            className='w-full'
            disabled={!level || isSubmitting}
            onClick={() => {
              if (level) onSubmit(level)
            }}
          >
            {isSubmitting ? t`Saving…` : t`Continue`}
          </Button>
        </div>
      </OverlayContent>
    </ResponsiveOverlay>
  )
}

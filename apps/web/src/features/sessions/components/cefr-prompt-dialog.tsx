import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'

const LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']

type Props = {
  open: boolean
  targetLanguage: string
  onSubmit: (level: CefrLevel) => void
  onCancel: () => void
}

export const CefrPromptDialog = ({ open, targetLanguage, onSubmit, onCancel }: Props) => {
  const { t } = useLingui()
  const [level, setLevel] = useState<CefrLevel>('B1')
  const languageName = getLanguageName(targetLanguage)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t`Your level in ${languageName}`}</DialogTitle>
        </DialogHeader>
        <p className='text-muted-foreground text-sm'>
          {t`This calibrates the difficult-words pass and the depth of explanations.`}
        </p>
        <RadioGroup value={level} onValueChange={(v) => setLevel(v as CefrLevel)}>
          {LEVELS.map((lvl) => (
            <div key={lvl} className='flex items-center gap-2 rounded-md border p-3'>
              <RadioGroupItem value={lvl} id={`cefr-${lvl}`} />
              <Label htmlFor={`cefr-${lvl}`} className='cursor-pointer'>
                {lvl}
              </Label>
            </div>
          ))}
        </RadioGroup>
        <DialogFooter>
          <Button variant='outline' onClick={onCancel}>{t`Cancel`}</Button>
          <Button onClick={() => onSubmit(level)}>{t`Save`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

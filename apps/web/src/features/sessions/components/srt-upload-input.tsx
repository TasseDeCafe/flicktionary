import { useRef, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Props = {
  onLoaded: (srtContent: string, fileName: string) => void
  disabled?: boolean
}

export const SrtUploadInput = ({ onLoaded, disabled }: Props) => {
  const { t } = useLingui()
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  const handleFile = async (file: File) => {
    setError(null)
    if (!file.name.toLowerCase().endsWith('.srt')) {
      setError(t`Please choose a .srt file.`)
      return
    }
    const text = await file.text()
    if (!text.trim()) {
      setError(t`The file appears to be empty.`)
      return
    }
    setFileName(file.name)
    onLoaded(text, file.name)
  }

  return (
    <div className='flex flex-col gap-2'>
      <input
        ref={inputRef}
        type='file'
        accept='.srt,text/plain'
        className='hidden'
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) {
            void handleFile(f)
          }
        }}
      />
      <Button
        type='button'
        variant='secondary'
        size='xl'
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className='w-full'
      >
        <Upload />
        {fileName ? t`Replace file (${fileName})` : t`Upload`}
      </Button>
      {error && <p className='text-destructive text-sm'>{error}</p>}
    </div>
  )
}

import { Sparkles } from 'lucide-react'

interface PracticeLoaderProps {
  label: string
}

export const PracticeLoader = ({ label }: PracticeLoaderProps) => (
  <div className='flex flex-1 items-center justify-center px-4'>
    <div className='text-muted-foreground flex flex-col items-center gap-3 text-center text-sm'>
      <Sparkles className='h-6 w-6 animate-pulse text-yellow-500' />
      {label}
    </div>
  </div>
)

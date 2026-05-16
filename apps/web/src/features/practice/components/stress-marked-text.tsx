interface StressMarkedTextProps {
  text: string
  className?: string
  lang?: string
}

export const StressMarkedText = ({ text, className, lang }: StressMarkedTextProps) => {
  return (
    <span className={className} lang={lang} style={{ fontFamily: 'Arial, sans-serif' }}>
      {text}
    </span>
  )
}

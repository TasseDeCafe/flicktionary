import { cn } from '@flicktionary/core/utils/tailwind-utils'

function displayTime(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(seconds / 60)
  const secondsInMinute = seconds % 60
  return String(minutes) + ':' + String(secondsInMinute).padStart(2, '0')
}

interface Props extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
  currentMilliseconds: number
  totalMilliseconds?: number
}

const TimeDisplay = ({ currentMilliseconds, totalMilliseconds, className, ...rest }: Props) => {
  const content =
    totalMilliseconds === undefined
      ? displayTime(currentMilliseconds)
      : `${displayTime(currentMilliseconds)} / ${displayTime(totalMilliseconds)}`
  return (
    <div
      className={cn('flex h-full cursor-default flex-col justify-center text-[20px] whitespace-nowrap text-white', className)}
      {...rest}
    >
      {`\n\n${content}\n\n`}
    </div>
  )
}

export default TimeDisplay

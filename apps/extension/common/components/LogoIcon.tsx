import { CSSProperties } from 'react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { flicktionaryLogoDataUri } from './flicktionary-logo'

interface Props {
  className?: string
  style?: CSSProperties
}

// The Flicktionary mark is a two-colour raster (black wing + yellow beam), so it
// can't be a single currentColor SVG path like the old asbplayer logo. The white
// rounded chip keeps the black part legible on dark surfaces (e.g. the video
// controls overlay). Sized like the old MUI SvgIcon 24px box by default —
// override via className/style.
const LogoIcon = ({ className, style }: Props) => {
  return (
    <img
      src={flicktionaryLogoDataUri}
      alt=''
      className={cn('size-6 rounded-[3px] bg-white p-px', className)}
      style={style}
    />
  )
}

export default LogoIcon

import SvgIcon, { SvgIconProps } from '@mui/material/SvgIcon'
import { flicktionaryLogoDataUri } from './flicktionary-logo'

// The Flicktionary mark is a two-colour raster (black wing + yellow beam), so it
// can't be a single SVG path like the old asbplayer logo. We embed it as a data
// URI inside SvgIcon — this keeps the component's fontSize-based sizing and API,
// and renders identically in every bundle and shadow-DOM overlay. The white
// rounded chip keeps the black part legible on dark surfaces (e.g. the video
// controls overlay).
const LogoIcon = ({ style, ...rest }: SvgIconProps) => {
  return (
    <SvgIcon viewBox='0 0 28 28' style={{ background: '#fff', borderRadius: 3, ...style }} {...rest}>
      <image href={flicktionaryLogoDataUri} x='1' y='1' width='26' height='26' />
    </SvgIcon>
  )
}

export default LogoIcon

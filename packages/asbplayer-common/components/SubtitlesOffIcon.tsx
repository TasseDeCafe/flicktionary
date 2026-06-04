import { SVGProps } from 'react'

// This icon is taken from Material Icons: https://github.com/mui/material-ui/tree/master/packages/mui-icons-material
// (plain SVG — the MUI SvgIcon wrapper went with the Radix/Tailwind migration;
// lucide has no subtitles-off glyph).

const SubtitlesOffIcon = (props: SVGProps<SVGSVGElement>) => {
  return (
    <svg viewBox='0 0 24 24' fill='currentColor' aria-hidden='true' {...props}>
      <path d='M20 4H6.83l8 8H20v2h-3.17l4.93 4.93c.15-.28.24-.59.24-.93V6c0-1.1-.9-2-2-2M1.04 3.87l1.2 1.2C2.09 5.35 2 5.66 2 6v12c0 1.1.9 2 2 2h13.17l2.96 2.96 1.41-1.41L2.45 2.45zM8 12v2H4v-2zm6 4.83V18H4v-2h9.17z' />
    </svg>
  )
}

export default SubtitlesOffIcon

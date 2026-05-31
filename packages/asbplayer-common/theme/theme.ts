import { createTheme as createMuiTheme, PaletteMode, ThemeOptions } from '@mui/material/styles'
import { red } from '@mui/material/colors'

// `overrides` is merged into the base options at creation time, so things like a
// custom `typography.pxToRem` are applied BEFORE MUI computes the variant font
// sizes. Used by ShadowMuiProvider to make typography px-based inside a Shadow
// DOM (rem would resolve against the host page's <html>, e.g. YouTube's 10px).
export const createTheme = (themeType: PaletteMode, overrides?: ThemeOptions) =>
  createMuiTheme({
    palette: {
      primary: {
        main: '#ff3f78',
      },
      error: {
        main: red.A400,
      },
      background: {
        default: 'rgba(0, 0, 0, 0)',
      },
      mode: themeType as PaletteMode,
    },
    ...overrides,
  })

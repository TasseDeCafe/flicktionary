import { createTheme as createMuiTheme, PaletteMode, ThemeOptions } from '@mui/material/styles'
import { red } from '@mui/material/colors'

// `overrides` is merged into the base options at creation time, so things like a
// custom `typography.pxToRem` are applied BEFORE MUI computes the variant font
// sizes. Used by ShadowMuiProvider to make typography px-based inside a Shadow
// DOM (rem would resolve against the host page's <html>, e.g. YouTube's 10px).
export const createTheme = (themeType: PaletteMode, overrides?: ThemeOptions) =>
  createMuiTheme({
    palette: {
      // Neutral primary that adapts to the theme mode so accents (labels,
      // toggles, buttons) stay high-contrast in both light and dark — a static
      // near-black would disappear in dark mode. The bright logo yellow is the
      // accent (secondary), used sparingly.
      primary: {
        main: themeType === 'dark' ? '#fafafa' : '#18181b',
      },
      secondary: {
        main: '#facc15',
      },
      error: {
        main: red.A400,
      },
      background: {
        default: 'rgba(0, 0, 0, 0)',
      },
      mode: themeType as PaletteMode,
    },
    // Keep text and buttons on the neutral primary (legible on both light/dark),
    // but route the interactive accents — toggles, sliders, selection controls,
    // and the selected-tab indicator — to the bright logo yellow so the UI isn't
    // pure black-and-white. Tab *labels* stay neutral (textColor defaults to
    // primary); only the indicator bar goes yellow.
    components: {
      MuiTabs: { defaultProps: { indicatorColor: 'secondary' } },
      MuiSwitch: { defaultProps: { color: 'secondary' } },
      MuiSlider: { defaultProps: { color: 'secondary' } },
      MuiRadio: { defaultProps: { color: 'secondary' } },
      MuiCheckbox: { defaultProps: { color: 'secondary' } },
      MuiLinearProgress: { defaultProps: { color: 'secondary' } },
      MuiCircularProgress: { defaultProps: { color: 'secondary' } },
    },
    ...overrides,
  })

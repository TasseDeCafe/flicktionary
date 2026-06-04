import { useMemo, type ReactNode } from 'react'
import ThemeProvider from '@mui/material/styles/ThemeProvider'
import { createTheme } from '../theme'

interface Props {
  themeType: 'dark' | 'light'
  children: ReactNode
}

// TEMPORARY scaffolding, deleted with the rest of MUI in Phase G2/G3.
//
// The settings shell is Radix/Tailwind now, but the complex tabs
// (SubtitleAppearance, KeyboardShortcuts) and SettingsProfileSelectMenu only
// get rewritten in Phase G2. Those components resolve their palette/spacing
// from the nearest MUI ThemeProvider — without one they fall back to MUI's
// default LIGHT theme, breaking dark mode and the yellow accent. This island
// re-provides the legacy theme around just those subtrees.
//
// No CssBaseline (Tailwind preflight owns the page base now) and no
// StyledEngineProvider: emotion's styles are un-layered, so they beat
// Tailwind's @layer-ed rules regardless of injection order.
export const MuiSettingsIsland = ({ themeType, children }: Props) => {
  const theme = useMemo(() => createTheme(themeType), [themeType])
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>
}

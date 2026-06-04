import { useMemo, type ReactNode } from 'react'
import ThemeProvider from '@mui/material/styles/ThemeProvider'
import { createTheme } from '@asbplayer-fork/common/theme'

interface Props {
  themeType: 'dark' | 'light'
  children: ReactNode
}

// TEMPORARY Phase-F scaffolding, deleted with the rest of MUI in Phase G.
//
// The popup pages are Radix/Tailwind now, but they still embed the MUI
// settings subtrees (SettingsForm, SettingsProfileSelectMenu, UiSettings,
// About) that only get rewritten in Phase G. Those components resolve their
// palette/spacing from the nearest MUI ThemeProvider — without one they fall
// back to MUI's default LIGHT theme, breaking dark mode and the yellow accent.
// This island re-provides the legacy theme around just those subtrees.
//
// No CssBaseline (Tailwind preflight owns the page base now) and no
// StyledEngineProvider: emotion's styles are un-layered, so they beat
// Tailwind's @layer-ed rules regardless of injection order.
export const MuiSettingsIsland = ({ themeType, children }: Props) => {
  const theme = useMemo(() => createTheme(themeType), [themeType])
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>
}

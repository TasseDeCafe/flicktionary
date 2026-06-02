import React from 'react'
import Box from '@mui/material/Box'
import MuiLink, { type LinkProps } from '@mui/material/Link'
import LogoIcon from './LogoIcon'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import MuiTableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import Typography from '@mui/material/Typography'
import { withStyles } from 'tss-react/mui'
import { useTheme } from '@mui/material/styles'
import { type Theme } from '@mui/material'
import { Trans } from '@lingui/react/macro'
import SettingsSection from './SettingsSection'

interface Props {
  appVersion?: string
  extensionVersion?: string
  insideExtension?: boolean
}

const Link = ({ children, ...props }: { children: React.ReactNode } & LinkProps) => {
  return (
    <MuiLink target='_blank' color='textPrimary' underline='always' {...props}>
      {children}
    </MuiLink>
  )
}

const TableCell = withStyles(MuiTableCell, (theme) => ({
  head: {
    backgroundColor: theme.palette.action.hover,
  },
  root: {
    border: 0,
  },
}))

const BorderedTableCell = withStyles(MuiTableCell, () => ({
  root: {},
}))

type Dependency = {
  name: string
  projectLink: string
  license: string
  licenseLink: string
  purpose: string
  extension?: boolean
}

const dependencies: Dependency[] = [
  {
    name: 'react',
    projectLink: 'https://react.dev',
    license: 'MIT',
    licenseLink: 'https://github.com/facebook/react/blob/v18.0.0/LICENSE',
    purpose: 'UI',
  },
  {
    name: 'Material UI',
    projectLink: 'https://mui.com/material-ui',
    license: 'MIT',
    licenseLink: 'https://github.com/mui/material-ui/blob/v4.x/LICENSE',
    purpose: 'UI',
  },
  {
    name: 'Roboto',
    projectLink: 'https://fonts.google.com/specimen/Roboto',
    license: 'Apache 2.0',
    licenseLink: 'https://fonts.google.com/specimen/Roboto/license',
    purpose: 'UI',
  },
  {
    name: 'Dexie.js',
    projectLink: 'https://dexie.org',
    license: 'Apache 2.0',
    licenseLink: 'https://github.com/dexie/Dexie.js/blob/master/LICENSE',
    purpose: 'Persistence',
  },
  {
    name: 'flatten-interval-tree',
    projectLink: 'https://github.com/alexbol99/flatten-interval-tree',
    license: 'MIT',
    licenseLink: 'https://github.com/alexbol99/flatten-interval-tree/blob/master/LICENSE',
    purpose: 'Subtitle rendering',
  },
  {
    name: 'srt-parser',
    projectLink: 'https://github.com/qgustavor/srt-parser',
    license: 'MIT',
    licenseLink: 'https://github.com/qgustavor/srt-parser/blob/master/LICENSE',
    purpose: 'Subtitle parsing',
  },
  {
    name: 'ass-compiler',
    projectLink: 'https://github.com/weizhenye/ass-compiler',
    license: 'MIT',
    licenseLink: 'https://github.com/weizhenye/ass-compiler/blob/master/LICENSE',
    purpose: 'Subtitle parsing',
  },
  {
    name: 'fast-xml-parser',
    projectLink: 'https://github.com/NaturalIntelligence/fast-xml-parser',
    license: 'MIT',
    licenseLink: 'https://github.com/NaturalIntelligence/fast-xml-parser/blob/master/LICENSE',
    purpose: 'Subtitle parsing',
  },
  {
    name: 'videojs-vtt.js',
    projectLink: 'https://github.com/videojs/vtt.js',
    license: 'Apache 2.0',
    licenseLink: 'https://github.com/videojs/vtt.js/blob/0.15.x/LICENSE',
    purpose: 'Subtitle parsing',
  },
  {
    name: 'semver',
    projectLink: 'https://github.com/npm/node-semver',
    license: 'ISC',
    licenseLink: 'https://github.com/npm/node-semver/blob/main/LICENSE',
    purpose: 'Version string parsing',
  },

  {
    name: 'hotkeys-js',
    projectLink: 'https://github.com/jaywcjlove/hotkeys-js',
    license: 'MIT',
    licenseLink: 'https://github.com/jaywcjlove/hotkeys-js/blob/master/LICENSE',
    purpose: 'Keyboard shortcuts',
  },
  {
    name: 'Lingui',
    projectLink: 'https://lingui.dev',
    license: 'MIT',
    licenseLink: 'https://github.com/lingui/js-lingui/blob/main/LICENSE',
    purpose: 'Localization',
  },
  {
    name: 'lamejs',
    projectLink: 'https://lame.sourceforge.io',
    license: 'LGPL',
    licenseLink: 'https://github.com/zhuker/lamejs/blob/master/LICENSE',
    purpose: 'MP3 encoding',
  },
  {
    name: 'sanitize-filename',
    projectLink: 'https://github.com/parshap/node-sanitize-filename',
    license: 'ISC+WTFPL',
    licenseLink: 'https://github.com/parshap/node-sanitize-filename/blob/master/LICENSE.md',
    purpose: 'Filename sanitization',
  },
  {
    name: 'uuidjs',
    projectLink: 'https://github.com/uuidjs/uuid',
    license: 'MIT',
    licenseLink: 'https://github.com/uuidjs/uuid/blob/main/LICENSE.md',
    purpose: 'UUID generation',
  },
  {
    name: 'url',
    projectLink: 'https://github.com/defunctzombie/node-url',
    license: 'MIT',
    licenseLink: 'https://github.com/defunctzombie/node-url/blob/master/LICENSE',
    purpose: 'Polyfill',
  },
  {
    name: 'm3u8-parser',
    projectLink: 'https://github.com/videojs/m3u8-parser',
    license: 'Apache 2.0',
    licenseLink: 'https://github.com/videojs/m3u8-parser/blob/main/LICENSE',
    purpose: 'Subtitle detection',
    extension: true,
  },
  {
    name: 'mpd-parser',
    projectLink: 'https://github.com/videojs/mpd-parser',
    license: 'Apache 2.0',
    licenseLink: 'https://github.com/videojs/mpd-parser/blob/main/LICENSE',
    purpose: 'Subtitle detection',
    extension: true,
  },
]

const dependencyPurposeCounts: { [key: string]: number } = {}

for (const dep of dependencies) {
  let count = dependencyPurposeCounts[dep.purpose] ?? 0
  dependencyPurposeCounts[dep.purpose] = count + 1
}

const About = ({ appVersion, extensionVersion }: Props) => {
  const theme = useTheme<Theme>()
  const renderedPurpose: { [key: string]: boolean } = {}
  let purposeIndex = 0
  return (
    <Box p={1} style={{ width: '100%' }}>
      <Box style={{ width: '100%', textAlign: 'center' }}>
        <LogoIcon style={{ width: 48, height: 48 }} />
        <br />
        <Link variant='h5' href='https://app.flicktionary.app'>
          Flicktionary
        </Link>
        <br />
        {appVersion && (
          <>
            <Typography variant='caption'>
              <Trans>App version</Trans>{' '}
              <Link href={`https://github.com/killergerbah/asbplayer/commit/${appVersion}`}>{appVersion}</Link>
            </Typography>
            <br />
          </>
        )}
        {extensionVersion && (
          <Typography variant='caption'>
            <Trans>Extension version</Trans>{' '}
            <Link href={`https://github.com/killergerbah/asbplayer/releases/tag/v${extensionVersion}`}>
              {extensionVersion}
            </Link>
          </Typography>
        )}
      </Box>
      <p />
    </Box>
  )
}

export default About

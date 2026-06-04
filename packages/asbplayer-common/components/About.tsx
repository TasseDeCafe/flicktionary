import React from 'react'
import LogoIcon from './LogoIcon'
import { Trans } from '@lingui/react/macro'

interface Props {
  appVersion?: string
  extensionVersion?: string
}

const Link = ({ children, ...props }: { children: React.ReactNode } & React.ComponentProps<'a'>) => {
  return (
    <a target='_blank' rel='noreferrer' className='underline underline-offset-4' {...props}>
      {children}
    </a>
  )
}

const About = ({ appVersion, extensionVersion }: Props) => {
  return (
    <div className='w-full p-2'>
      <div className='flex w-full flex-col items-center gap-1 text-center'>
        <LogoIcon style={{ width: 48, height: 48 }} />
        <Link href='https://app.flicktionary.app' className='text-2xl'>
          Flicktionary
        </Link>
        {appVersion && (
          <span className='text-muted-foreground text-xs'>
            <Trans>App version</Trans>{' '}
            <Link href={`https://github.com/killergerbah/asbplayer/commit/${appVersion}`}>{appVersion}</Link>
          </span>
        )}
        {extensionVersion && (
          <span className='text-muted-foreground text-xs'>
            <Trans>Extension version</Trans>{' '}
            <Link href={`https://github.com/killergerbah/asbplayer/releases/tag/v${extensionVersion}`}>
              {extensionVersion}
            </Link>
          </span>
        )}
      </div>
    </div>
  )
}

export default About

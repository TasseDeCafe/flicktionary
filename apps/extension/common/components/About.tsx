import React from 'react'
import LogoIcon from './LogoIcon'
import { Trans } from '@lingui/react/macro'

interface Props {
  extensionVersion?: string
}

const Link = ({ children, ...props }: { children: React.ReactNode } & React.ComponentProps<'a'>) => {
  return (
    <a target='_blank' rel='noreferrer' className='underline underline-offset-4' {...props}>
      {children}
    </a>
  )
}

const About = ({ extensionVersion }: Props) => {
  return (
    <div className='w-full p-2'>
      <div className='flex w-full flex-col items-center gap-1 text-center'>
        <LogoIcon style={{ width: 48, height: 48 }} />
        <Link href='https://app.flicktionary.app' className='text-2xl'>
          Flicktionary
        </Link>
        {extensionVersion && (
          <span className='text-muted-foreground text-xs'>
            <Trans>Extension version</Trans> {extensionVersion}
          </span>
        )}
      </div>
    </div>
  )
}

export default About

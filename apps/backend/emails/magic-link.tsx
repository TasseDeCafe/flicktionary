import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Tailwind,
  Text,
  pixelBasedPreset,
} from '@react-email/components'
import * as React from 'react'

interface MagicLinkEmailProps {
  magicLink?: string
}

export const MagicLinkEmail = ({
  magicLink = '{{ .RedirectTo }}token_hash={{ .TokenHash }}&type=magiclink&referral={{ .Data.referral }}&utm_source={{ .Data.utmSource }}&utm_medium={{ .Data.utmMedium }}&utm_campaign={{ .Data.utmCampaign }}&utm_term={{ .Data.utmTerm }}&utm_content={{ .Data.utmContent }}',
}: MagicLinkEmailProps) => {
  return (
    <Html>
      <Head />
      <Preview>Sign in to TemplateApp</Preview>
      <Tailwind
        config={{
          presets: [pixelBasedPreset],
          theme: {
            extend: {
              colors: {
                brand: '#3F51B5',
              },
            },
          },
        }}
      >
        <Body className='bg-gray-100 font-sans'>
          <Container className='mx-auto mb-16 bg-white px-0 py-5'>
            <Heading className='my-10 px-0 text-center text-2xl font-bold text-gray-800'>
              Welcome to TemplateApp!
            </Heading>

            <Text className='px-10 text-center text-base leading-relaxed text-gray-800'>
              Follow this link to sign in to your account:
            </Text>

            <Section className='px-10 py-7 text-center'>
              <Button
                className='bg-brand block w-full rounded py-3 text-center text-base font-bold text-white'
                href={magicLink}
              >
                Sign In
              </Button>
            </Section>

            <Text className='mt-6 px-10 text-center text-sm leading-normal text-gray-500'>
              This link is valid for 1 hour. If you didn't request this email, please ignore this message.
            </Text>

            <Text className='mt-3 break-all px-10 text-center text-xs leading-tight text-gray-500'>
              Or copy and paste this URL into your browser:{' '}
              <Link href={magicLink} className='text-brand underline'>
                {magicLink}
              </Link>
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}

export default MagicLinkEmail

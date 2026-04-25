import React from 'react'
import { Trans } from '@lingui/react/macro'
import { ButtonLeadingToWebapp } from '@/app/[lang]/(components)/(leading-to-apps)/button-leading-to-webapp'
import { QRCodeButton } from '@/app/[lang]/(components)/qr-code-button'
import { getConfig } from '@/config/environment-config'

export const HeroSection = () => {
  return (
    <section className='container mx-auto mt-8 px-4 sm:px-10 md:mt-16'>
      <div className='mb-16 flex flex-col items-center justify-between lg:flex-row'>
        <div className='mb-8 w-full lg:mb-0 lg:w-1/2 lg:pr-8'>
          <h1 className='mb-6 text-6xl font-bold text-stone-900'>
            <Trans>Some super cool title!</Trans>
          </h1>
          <p className='mb-8 text-lg text-stone-900 sm:text-xl'>
            <Trans>Some super cool text!</Trans>
          </p>

          <div className='flex flex-col gap-4 md:flex-row md:items-center'>
            {getConfig().featureFlags.shouldInformAboutIosNativeApp() ? (
              <>
                <QRCodeButton
                  qrText={<Trans>Download the App</Trans>}
                  modalTitle={<Trans>Get the App</Trans>}
                  modalSubtitle={<Trans>Scan the QR code to download the app</Trans>}
                  orCopyLinksTo={<Trans>or copy links to</Trans>}
                  appStore={<Trans>App Store</Trans>}
                  playStore={<Trans>Play Store</Trans>}
                  copied={<Trans>Copied!</Trans>}
                />
                <ButtonLeadingToWebapp
                  analyticsClickName='start_button_in_hero_section'
                  buttonText={<Trans>Use on Web</Trans>}
                  className='hidden h-14 w-72 items-center justify-center gap-2 border border-stone-200 bg-white px-6 text-xl text-stone-700 hover:bg-stone-50 md:flex'
                />
                <ButtonLeadingToWebapp
                  analyticsClickName='start_button_in_hero_section'
                  buttonText={<Trans>Use on Web</Trans>}
                  className='flex h-14 w-72 items-center justify-center bg-gradient-to-r from-orange-500 to-amber-500 px-8 py-2 text-xl font-medium text-white shadow-lg md:hidden'
                />
              </>
            ) : (
              <ButtonLeadingToWebapp
                analyticsClickName='start_button_in_hero_section'
                buttonText={<Trans>Get Started</Trans>}
                className='flex h-14 w-72 items-center justify-center bg-gradient-to-r from-orange-500 to-amber-500 px-8 py-2 text-xl font-medium text-white shadow-lg'
              />
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

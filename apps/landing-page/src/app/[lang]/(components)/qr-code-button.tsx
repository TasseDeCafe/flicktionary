'use client'

import React, { ReactNode, useState } from 'react'
import { QrCode } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { QRCodeModal } from '@/app/[lang]/(components)/qr-code-modal'
import { getConfig } from '@/config/environment-config'
import Image from 'next/image'
import { POSTHOG_EVENTS } from '@/lib/analytics/posthog-events'

interface QRCodeButtonProps {
  qrText: ReactNode
  modalTitle: ReactNode
  modalSubtitle: ReactNode
  orCopyLinksTo: ReactNode
  appStore: ReactNode
  playStore: ReactNode
  copied: ReactNode
}

export const QRCodeButton = ({
  qrText,
  modalTitle,
  modalSubtitle,
  orCopyLinksTo,
  appStore,
  playStore,
  copied,
}: QRCodeButtonProps) => {
  const [isQRModalOpen, setIsQRModalOpen] = useState(false)

  const handleQRButtonClick = () => {
    POSTHOG_EVENTS.click('open_qr_code_button')
    setIsQRModalOpen(true)
  }

  const handleCloseQRModal = () => {
    setIsQRModalOpen(false)
  }

  return (
    <div className='hidden md:block'>
      {/* QR Code button - only visible on desktop (md and larger) */}
      <Button
        onClick={handleQRButtonClick}
        className='flex h-14 w-72 items-center justify-center gap-x-2 bg-gradient-to-r from-orange-500 to-amber-500 px-8 py-2 text-xl font-medium text-white shadow-lg'
      >
        {getConfig().featureFlags.shouldInformAboutIosNativeApp() &&
          getConfig().featureFlags.shouldInformAboutAndroidNativeApp() && <QrCode className='h-6 w-6' />}
        {getConfig().featureFlags.shouldInformAboutIosNativeApp() &&
          !getConfig().featureFlags.shouldInformAboutAndroidNativeApp() && (
            <div className='relative h-5 w-5'>
              <Image
                src='/images/icons/apple-logo.svg'
                alt='apple logo'
                width={20}
                height={20}
                priority
                className='absolute -top-1 left-0 flex-shrink-0 brightness-0 invert'
              />
            </div>
          )}

        {qrText}
      </Button>

      {/* QR Code Modal */}
      <QRCodeModal
        isOpen={isQRModalOpen}
        onClose={handleCloseQRModal}
        title={modalTitle}
        subtitle={modalSubtitle}
        orCopyLinksTo={orCopyLinksTo}
        appStore={appStore}
        playStore={playStore}
        copied={copied}
      />
    </div>
  )
}

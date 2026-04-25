'use client'

import { ReactNode, useEffect, useState } from 'react'
import { Check, Copy, X } from 'lucide-react'
import Image from 'next/image'
import QRCode from 'qrcode'
import { Button } from '@/components/ui/button'
import { getConfig } from '@/config/environment-config'
import { buildIosAppStoreLink } from '@/app/[lang]/(components)/(leading-to-apps)/ios-app-store-link-utils'
import { buildAndroidPlayStoreLink } from '@/app/[lang]/(components)/(leading-to-apps)/google-play-store-link-utils'
import { POSTHOG_EVENTS } from '@/lib/analytics/posthog-events'

interface QRCodeModalProps {
  isOpen: boolean
  onClose: () => void
  title: ReactNode
  subtitle: ReactNode
  orCopyLinksTo: ReactNode
  appStore: ReactNode
  playStore: ReactNode
  copied: ReactNode
}

export const QRCodeModal = ({
  isOpen,
  onClose,
  title,
  subtitle,
  orCopyLinksTo,
  appStore,
  playStore,
  copied,
}: QRCodeModalProps) => {
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('')
  const [appStoreUrl, setAppStoreUrl] = useState<string>('')
  const [androidStoreLink, setAndroidStoreLink] = useState<string>('')
  const [iosCopied, setIosCopied] = useState(false)
  const [androidCopied, setAndroidCopied] = useState(false)

  useEffect(() => {
    if (isOpen) {
      const params = new URLSearchParams()

      // Add referral and UTM parameters only if they're not empty
      const referral = localStorage.getItem('referral') || ''
      const utm_source = localStorage.getItem('utm_source') || ''
      const utm_campaign = localStorage.getItem('utm_campaign') || ''
      const utm_medium = localStorage.getItem('utm_medium') || ''
      const utm_content = localStorage.getItem('utm_content') || ''
      const utm_term = localStorage.getItem('utm_term') || ''

      if (referral) {
        params.append('referral', referral)
      }
      if (utm_source) {
        params.append('utm_source', utm_source)
      }
      if (utm_campaign) {
        params.append('utm_campaign', utm_campaign)
      }
      if (utm_medium) {
        params.append('utm_medium', utm_medium)
      }
      if (utm_content) {
        params.append('utm_content', utm_content)
      }
      if (utm_term) {
        params.append('utm_term', utm_term)
      }

      const queryString = params.toString()
      // qr code is opened almost always on a different device, so we need to pass all tracking params
      const url = `${getConfig().landingPageUrl}/qr-code-link${queryString ? `?${queryString}` : ''}`

      QRCode.toDataURL(url, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
        errorCorrectionLevel: 'M',
      })
        .then((dataUrl) => {
          setQrCodeDataUrl(dataUrl)
        })
        .catch((err) => {
          console.error('Error generating QR code:', err)
        })
    }
  }, [isOpen])

  useEffect(() => {
    const iosAppStoreUrl = buildIosAppStoreLink()
    const androidPlayStoreUrl = buildAndroidPlayStoreLink()
    setAppStoreUrl(iosAppStoreUrl)
    setAndroidStoreLink(androidPlayStoreUrl)
  }, [isOpen])

  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        handleClose()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscapeKey)
    }

    return () => {
      document.removeEventListener('keydown', handleEscapeKey)
    }
  }, [isOpen])

  const handleCopyIosLink = async () => {
    POSTHOG_EVENTS.click('copy_ios_store_link_in_qr_code_modal')
    try {
      await navigator.clipboard.writeText(appStoreUrl)
      setIosCopied(true)
      setTimeout(() => setIosCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy iOS link:', err)
    }
  }

  const handleCopyAndroidLink = async () => {
    POSTHOG_EVENTS.click('copy_android_store_link_in_qr_code_modal')
    try {
      await navigator.clipboard.writeText(androidStoreLink)
      setAndroidCopied(true)
      setTimeout(() => setAndroidCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy Android link:', err)
    }
  }

  const handleClose = () => {
    setIosCopied(false)
    setAndroidCopied(false)
    onClose()
  }

  if (!isOpen) {
    return null
  }

  return (
    <>
      <div className='fixed inset-0 z-50 bg-black/50 backdrop-blur-sm' />

      <div className='fixed inset-0 z-50 flex items-center justify-center p-4' onClick={handleClose}>
        <div
          className='relative mx-auto w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl'
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleClose}
            className='absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-700'
          >
            <X className='h-4 w-4' />
          </button>

          <div className='text-center'>
            <h2 className='mb-2 text-2xl font-bold text-gray-900'>{title}</h2>
            <p className='mb-6 text-gray-600'>{subtitle}</p>

            <div className='mb-6 flex justify-center'>
              {qrCodeDataUrl ? (
                <div className=''>
                  <Image
                    src={qrCodeDataUrl}
                    alt='QR Code to download the app'
                    width={300}
                    height={300}
                    className='h-auto w-full max-w-[250px]'
                  />
                </div>
              ) : (
                <div className='flex h-[250px] w-[250px] items-center justify-center rounded-xl bg-gray-100'>
                  <div className='text-gray-500'>Generating QR code...</div>
                </div>
              )}
            </div>

            <div className='space-y-4'>
              <p className='text-center text-gray-600'>{orCopyLinksTo}</p>

              <div className='space-y-3'>
                <Button
                  onClick={handleCopyIosLink}
                  className='flex h-14 w-full items-center justify-center gap-2 border border-stone-200 bg-white px-6 text-xl text-stone-700 hover:bg-stone-50'
                >
                  {iosCopied ? (
                    <>
                      <Check className='h-4 w-4' />
                      {copied}
                    </>
                  ) : (
                    <>
                      <Image
                        src='/images/icons/apple-logo.svg'
                        alt='Apple logo'
                        width={16}
                        height={20}
                        className='brightness-0'
                      />
                      <span>{appStore}</span>
                      <Copy className='h-4 w-4' />
                    </>
                  )}
                </Button>

                <Button
                  onClick={handleCopyAndroidLink}
                  className='flex h-14 w-full items-center justify-center gap-2 border border-stone-200 bg-white px-6 text-xl text-stone-700 hover:bg-stone-50'
                >
                  {androidCopied ? (
                    <>
                      <Check className='h-4 w-4' />
                      {copied}
                    </>
                  ) : (
                    <>
                      <Image
                        src='/images/icons/android-logo.svg'
                        alt='Android logo'
                        width={20}
                        height={12}
                        className='brightness-0'
                      />
                      <span>{playStore}</span>
                      <Copy className='h-4 w-4' />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

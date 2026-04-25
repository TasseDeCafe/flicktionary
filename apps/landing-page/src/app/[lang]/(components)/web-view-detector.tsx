'use client'

import { useEffect } from 'react'
import { localStorageWrapper } from '@/lib/storage/local-storage'
import { getConfig } from '@/config/environment-config'
import {
  isAndroid,
  isFacebookNativeWebviewApp,
  isInstagramWebviewNativeApp,
  isIos,
  isLinkedinNativeWebview,
} from '@template-app/core/utils/browser-utils'

const tryOpeningInBrowser = () => {
  const referral = `${localStorageWrapper.getReferral()}`
  let urlToOpenInBrowser = ''
  if (referral) {
    urlToOpenInBrowser = `${getConfig().landingPageUrl}/partners/${referral}`
  } else {
    urlToOpenInBrowser = getConfig().landingPageUrl
  }
  const urlWithoutHttps = urlToOpenInBrowser.replace('https://', '')

  if (isAndroid()) {
    // when the app is opened in the browser, the colon symbol ":" is stripped from the "https://" part of the url
    // and makes the url not working. We can strip the protocol though, as our landing page redirects urls without protocol
    // to "https://" protocol, I (Kamil) think this was set up in vercel in the past:
    // https://vercel.com/grammarians/template-app-com/settings/domains
    const androidIntentUrl = `intent://${urlWithoutHttps}#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;end`
    // todo the line below is broken after a weird change on android, read more here: https://www.notion.so/grammarians/on-android-instagram-links-to-our-app-open-in-the-instagram-webview-instead-of-opening-the-browser-12c168e7b01a80e596aeea2ccddfdf81
    // there's no easy fix yet
    window.location.href = androidIntentUrl
  } else if (isIos()) {
    window.location.href = `x-safari-${urlToOpenInBrowser}`
  }
}

export const WebViewDetector = () => {
  useEffect(() => {
    if (isLinkedinNativeWebview() || isInstagramWebviewNativeApp() || isFacebookNativeWebviewApp()) {
      tryOpeningInBrowser()
    }
  }, [])
  return null
}

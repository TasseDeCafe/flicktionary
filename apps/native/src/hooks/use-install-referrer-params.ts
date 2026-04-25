import { useEffect, useState } from 'react'
import { Platform } from 'react-native'
import {
  PlayInstallReferrer,
  type PlayInstallReferrerInfo,
  type PlayInstallReferrerError,
} from 'react-native-play-install-referrer'
import { logWithSentry } from '@/lib/analytics/log-with-sentry'

interface InstallReferrerParams {
  referral: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmTerm: string | null
  utmContent: string | null
}

export const useInstallReferrerParams = (): InstallReferrerParams | null => {
  const [urlParams, setUrlParams] = useState<InstallReferrerParams | null>(null)

  useEffect(() => {
    if (Platform.OS === 'android') {
      PlayInstallReferrer.getInstallReferrerInfo(
        (info: PlayInstallReferrerInfo | null, error: PlayInstallReferrerError | null) => {
          if (!error && info && info.installReferrer) {
            try {
              const params = new URLSearchParams(info.installReferrer)
              setUrlParams({
                referral: params.get('referral'),
                utmSource: params.get('utm_source'),
                utmMedium: params.get('utm_medium'),
                utmCampaign: params.get('utm_campaign'),
                utmTerm: params.get('utm_term'),
                utmContent: params.get('utm_content'),
              })
            } catch (error) {
              logWithSentry('Failed to parse install referrer:', error)
              setUrlParams({
                referral: null,
                utmSource: 'android_playstore',
                utmMedium: 'organic_referrer_parse_error',
                utmCampaign: null,
                utmTerm: null,
                utmContent: null,
              })
            }
          } else {
            logWithSentry('No install referrer info or error:', error)
            setUrlParams({
              referral: null,
              utmSource: 'android_playstore',
              utmMedium: 'organic_no_referrer',
              utmCampaign: null,
              utmTerm: null,
              utmContent: null,
            })
          }
        }
      )
    } else {
      // iOS doesn't have an install referrer, only aggregate data on App Store Connect
      setUrlParams({
        referral: null,
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        utmTerm: null,
        utmContent: null,
      })
    }
  }, [])

  return urlParams
}

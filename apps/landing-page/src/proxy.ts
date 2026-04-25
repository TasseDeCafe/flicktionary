import { NextRequest, NextResponse } from 'next/server'

import { match } from '@formatjs/intl-localematcher'
import Negotiator from 'negotiator'
import { i18nConfig } from '@/lib/i18n/i18n-config'
import { createPlainObjectHeaders } from '@/utils/headers-utils'

// the function below is based on the official example from the docs:
// github.com/vercel/next.js/blob/canary/examples/app-dir-i18n-routing/middleware.ts
const getLocale = (request: NextRequest): string | undefined => {
  const negotiatorHeaders: Record<string, string> = createPlainObjectHeaders(request.headers)
  const locales: string[] = i18nConfig.locales
  const languages: string[] = new Negotiator({ headers: negotiatorHeaders }).languages(locales)

  return match(languages, locales, i18nConfig.defaultLocale)
}

export const proxy = (request: NextRequest) => {
  const pathname = request.nextUrl.pathname
  const isPathnameMissingLocale = i18nConfig.locales.every(
    (locale) => !pathname.startsWith(`/${locale}/`) && pathname !== `/${locale}`
  )

  if (isPathnameMissingLocale) {
    const locale = getLocale(request)
    const newUrl = new URL(`/${locale}${pathname}`, request.url)

    // Preserve query parameters
    request.nextUrl.searchParams.forEach((value, key) => {
      newUrl.searchParams.append(key, value)
    })

    return NextResponse.redirect(newUrl)
  }
}

export const config = {
  matcher: [
    // Skip all internal paths (_next), images, and others as in this answer:
    // https://stackoverflow.com/a/76352546/3975247
    '/((?!api|_next/static|_next/image|.well-known|images|favicon.ico|twitter-image.png|opengraph-image.png|icon.png|apple-icon.png|links/|yba-admin|yba-admin/clear-data).*)',
  ],
}

import { describe, expect, it } from 'vitest'
import { __buildIosAppStoreLink } from './ios-app-store-link-utils'

describe('iOS App Store Link Utils', () => {
  describe('__buildIosAppStoreLink', () => {
    const baseUrl = 'https://apps.apple.com/app/apple-store/id6741498422?pt=127597524&mt=8'

    it('should use referral as ct parameter when referral is provided', () => {
      const referral = 'my-referral-code'
      const utm_source = 'google'
      const utm_campaign = 'summer-sale'
      const utm_medium = 'cpc'
      const utm_content = 'banner'
      const utm_term = 'keyword'

      const result = __buildIosAppStoreLink(referral, utm_source, utm_campaign, utm_medium, utm_content, utm_term)

      expect(result).toBe(`${baseUrl}&ct=${referral}`)
    })

    it('should use default utm parameters when no referral and no utm params', () => {
      const referral = ''
      const utm_source = ''
      const utm_campaign = ''
      const utm_medium = ''
      const utm_content = ''
      const utm_term = ''

      const result = __buildIosAppStoreLink(referral, utm_source, utm_campaign, utm_medium, utm_content, utm_term)
      const expectedCt = 'website|default|web||'

      expect(result).toBe(`${baseUrl}&ct=${expectedCt}`)
    })

    it('should build ct from utm parameters in priority order when referral is empty string', () => {
      const referral = ''
      const utm_source = 'facebook'
      const utm_campaign = 'holiday-promo'
      const utm_medium = 'social'
      const utm_content = 'banner'
      const utm_term = 'christmas'

      const result = __buildIosAppStoreLink(referral, utm_source, utm_campaign, utm_medium, utm_content, utm_term)
      const expectedCt = `${utm_source}|${utm_campaign}|${utm_medium}`

      expect(result).toBe(`${baseUrl}&ct=${expectedCt}`)
    })

    it('should include only source when other params are ""', () => {
      const referral = ''
      const utm_source = 'twitter'
      const utm_campaign = ''
      const utm_medium = ''
      const utm_content = ''
      const utm_term = ''

      const result = __buildIosAppStoreLink(referral, utm_source, utm_campaign, utm_medium, utm_content, utm_term)
      const expectedCt = 'twitter||||'

      expect(result).toBe(`${baseUrl}&ct=${expectedCt}`)
    })

    it('should handle empty string utm parameters when any utm param is provided', () => {
      const referral = ''
      const utm_source = ''
      const utm_campaign = 'spring-sale'
      const utm_medium = ''
      const utm_content = 'sidebar'
      const utm_term = ''

      const result = __buildIosAppStoreLink(referral, utm_source, utm_campaign, utm_medium, utm_content, utm_term)
      const expectedCt = '|spring-sale||sidebar|'

      expect(result).toBe(`${baseUrl}&ct=${expectedCt}`)
    })

    it('should stop adding parameters when 30 character limit would be exceeded', () => {
      const referral = ''
      const utm_source = 'very-long-source-name'
      const utm_campaign = 'very-long-campaign'
      const utm_medium = 'very-long-medium'
      const utm_content = 'very-long-content'
      const utm_term = 'very-long-term'

      const result = __buildIosAppStoreLink(referral, utm_source, utm_campaign, utm_medium, utm_content, utm_term)

      // utm_source is 20 chars, adding |utm_campaign would make it 37 chars, so it stops at source
      const expectedCt = utm_source // 20 chars

      expect(result).toBe(`${baseUrl}&ct=${expectedCt}`)
      expect(expectedCt.length).toBeLessThanOrEqual(30)
    })

    it('should include all parameters when total length is 30 characters or less', () => {
      const referral = ''
      const utm_source = 'fb'
      const utm_campaign = 'sale'
      const utm_medium = 'cpc'
      const utm_content = 'ad'
      const utm_term = 'key'

      const expectedCt = `${utm_source}|${utm_campaign}|${utm_medium}|${utm_content}|${utm_term}`
      expect(expectedCt.length).toBeLessThanOrEqual(30)

      const result = __buildIosAppStoreLink(referral, utm_source, utm_campaign, utm_medium, utm_content, utm_term)

      expect(result).toBe(`${baseUrl}&ct=${expectedCt}`)
    })

    it('should prioritize source over other parameters', () => {
      const referral = ''
      const utm_source = 'important-source-value'
      const utm_campaign = ''
      const utm_medium = ''
      const utm_content = ''
      const utm_term = ''

      const result = __buildIosAppStoreLink(referral, utm_source, utm_campaign, utm_medium, utm_content, utm_term)
      const expectedCt = 'important-source-value||||'

      expect(result).toBe(`${baseUrl}&ct=${expectedCt}`)
    })

    it('should handle mixed "" and non-"" utm parameters', () => {
      const referral = ''
      const utm_source = 'google'
      const utm_campaign = ''
      const utm_medium = 'organic'
      const utm_content = ''
      const utm_term = 'search-term'

      const result = __buildIosAppStoreLink(referral, utm_source, utm_campaign, utm_medium, utm_content, utm_term)
      const expectedCt = 'google||organic||search-term'

      expect(result).toBe(`${baseUrl}&ct=${expectedCt}`)
    })

    it('should handle case where only lower priority params are provided', () => {
      const referral = ''
      const utm_source = ''
      const utm_campaign = ''
      const utm_medium = ''
      const utm_content = 'banner-ad'
      const utm_term = 'keyword'

      const result = __buildIosAppStoreLink(referral, utm_source, utm_campaign, utm_medium, utm_content, utm_term)
      const expectedCt = '|||banner-ad|keyword'

      expect(result).toBe(`${baseUrl}&ct=${expectedCt}`)
    })

    it('should fallback to defaults if ct would be empty', () => {
      const referral = ''
      const utm_source = ''
      const utm_campaign = ''
      const utm_medium = ''
      const utm_content = ''
      const utm_term = ''

      const result = __buildIosAppStoreLink(referral, utm_source, utm_campaign, utm_medium, utm_content, utm_term)

      const expectedCt = 'website|default|web||'

      expect(result).toBe(`${baseUrl}&ct=${expectedCt}`)
    })
  })
})

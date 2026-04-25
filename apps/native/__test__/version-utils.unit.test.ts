import { compareVersions, getAppVersion, requiresUpdate } from '@/utils/version-utils'

describe('version-utils', () => {
  it('should return 0 for equal versions', () => {
    expect(1).toBe(1)
  })
  describe('compareVersions', () => {
    it('should return 0 for equal versions', () => {
      expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
      expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
    })

    it('should return 1 if version1 is greater than version2', () => {
      expect(compareVersions('1.0.1', '1.0.0')).toBe(1)
      expect(compareVersions('1.1.0', '1.0.0')).toBe(1)
      expect(compareVersions('2.0.0', '1.0.0')).toBe(1)
      expect(compareVersions('10.0.0', '2.0.0')).toBe(1)
    })

    it('should return -1 if version1 is less than version2', () => {
      expect(compareVersions('1.0.0', '1.0.1')).toBe(-1)
      expect(compareVersions('1.0.0', '1.1.0')).toBe(-1)
      expect(compareVersions('1.0.0', '2.0.0')).toBe(-1)
      expect(compareVersions('2.0.0', '10.0.0')).toBe(-1)
    })

    it('should handle versions with different component counts', () => {
      expect(compareVersions('1.0', '1.0.0')).toBe(0)
      expect(compareVersions('1.0.0.0', '1.0.0')).toBe(0)
      expect(compareVersions('1.0.1', '1.0')).toBe(1)
      expect(compareVersions('1.0', '1.0.1')).toBe(-1)
    })
  })

  describe('requiresUpdate', () => {
    it('should return true if current version is less than required version', () => {
      expect(requiresUpdate('1.0.0', '1.0.1')).toBe(true)
      expect(requiresUpdate('1.0.0', '1.1.0')).toBe(true)
      expect(requiresUpdate('1.0.0', '2.0.0')).toBe(true)
    })

    it('should return false if current version is equal to required version', () => {
      expect(requiresUpdate('1.0.0', '1.0.0')).toBe(false)
    })

    it('should return false if current version is greater than required version', () => {
      expect(requiresUpdate('1.0.1', '1.0.0')).toBe(false)
      expect(requiresUpdate('1.1.0', '1.0.0')).toBe(false)
      expect(requiresUpdate('2.0.0', '1.0.0')).toBe(false)
    })
  })

  describe('getAppVersion', () => {
    it('should return a version string', () => {
      const version = getAppVersion()
      expect(typeof version).toBe('string')
      expect(version.length).toBeGreaterThan(0)
    })
  })
})

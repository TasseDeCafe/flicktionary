import { describe, it, expect } from 'vitest'
import { isInUuidFormat } from './uuid-utils'

describe('isInUuidFormat', () => {
  it('should return true for valid UUID v4 format', () => {
    const validUuids = [
      '550e8400-e29b-41d4-a716-446655440000',
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      '12345678-1234-5678-9abc-123456789abc',
      'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    ]

    validUuids.forEach((uuid) => {
      expect(isInUuidFormat(uuid)).toBe(true)
    })
  })

  it('should return true for valid UUID with uppercase letters', () => {
    const validUuids = [
      '550E8400-E29B-41D4-A716-446655440000',
      'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
      'F47AC10B-58CC-4372-A567-0E02B2C3D479',
    ]

    validUuids.forEach((uuid) => {
      expect(isInUuidFormat(uuid)).toBe(true)
    })
  })

  it('should return false for invalid UUID formats', () => {
    const invalidUuids = [
      '',
      'not-a-uuid',
      '550e8400-e29b-41d4-a716',
      '550e8400-e29b-41d4-a716-446655440000-extra',
      '550e8400-e29b-41d4-a716-44665544000',
      '550e8400-e29b-41d4-a716-44665544000g',
      '550e8400e29b41d4a716446655440000',
      '550e8400-e29b-41d4-a716-44665544000z',
      'gggggggg-gggg-gggg-gggg-gggggggggggg',
      '550e8400-e29b-41d4-a716-44665544000!',
      '550e8400-e29b-41d4-a716-44665544000@',
      '123',
    ]

    invalidUuids.forEach((uuid) => {
      expect(isInUuidFormat(uuid)).toBe(false)
    })
  })

  it('should return false for UUID with wrong segment lengths', () => {
    const invalidUuids = [
      '550e840-e29b-41d4-a716-446655440000',
      '550e8400-e29-41d4-a716-446655440000',
      '550e8400-e29b-41d-a716-446655440000',
      '550e8400-e29b-41d4-a71-446655440000',
      '550e8400-e29b-41d4-a716-44665544000',
    ]

    invalidUuids.forEach((uuid) => {
      expect(isInUuidFormat(uuid)).toBe(false)
    })
  })

  it('should return false for strings with spaces', () => {
    expect(isInUuidFormat(' 550e8400-e29b-41d4-a716-446655440000')).toBe(false)
    expect(isInUuidFormat('550e8400-e29b-41d4-a716-446655440000 ')).toBe(false)
    expect(isInUuidFormat('550e8400 e29b-41d4-a716-446655440000')).toBe(false)
  })
})

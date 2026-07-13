import { expect, describe, it } from 'vitest'
import { calculatePaymentNumber } from './payment-utils'

describe('calculatePaymentNumber', () => {
  const createdAt = new Date('2023-01-01')

  it('should correctly calculate payment numbers for monthly subscriptions', () => {
    const testCases = [
      { currentDate: new Date('2023-01-15'), expected: 1 },
      { currentDate: new Date('2023-02-01'), expected: 2 },
      { currentDate: new Date('2023-03-01'), expected: 3 },
      { currentDate: new Date('2023-12-31'), expected: 12 },
      { currentDate: new Date('2024-01-01'), expected: 13 },
    ]

    testCases.forEach(({ currentDate, expected }) => {
      const result = calculatePaymentNumber(createdAt, 'month', currentDate)
      expect(result).toBe(expected)
    })
  })

  it('should correctly calculate payment numbers for yearly subscriptions', () => {
    const testCases = [
      { currentDate: new Date('2023-06-15'), expected: 1 },
      { currentDate: new Date('2024-01-01'), expected: 2 },
      { currentDate: new Date('2024-01-02'), expected: 2 },
      { currentDate: new Date('2025-12-31'), expected: 3 },
      { currentDate: new Date('2026-01-01'), expected: 4 },
    ]

    testCases.forEach(({ currentDate, expected }) => {
      const result = calculatePaymentNumber(createdAt, 'year', currentDate)
      expect(result).toBe(expected)
    })
  })
})

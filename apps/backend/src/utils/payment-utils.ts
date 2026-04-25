export const calculatePaymentNumber = (
  createdAt: Date,
  interval: 'month' | 'year',
  currentDate: Date = new Date()
): number => {
  const monthsDiff =
    (currentDate.getFullYear() - createdAt.getFullYear()) * 12 + currentDate.getMonth() - createdAt.getMonth()

  if (interval === 'year') {
    return Math.floor(monthsDiff / 12) + 1
  } else {
    return monthsDiff + 1
  }
}

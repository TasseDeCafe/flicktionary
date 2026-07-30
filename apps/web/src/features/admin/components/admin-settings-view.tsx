import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { Button } from '@flicktionary/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@flicktionary/ui/components/card'
import { logError } from '@/lib/analytics/log-error.ts'
import { useTriggerErrorMessageMutation } from '@/features/admin/api/error-debug-hooks.ts'
import { useAdvancePracticeClockMutation } from '@/features/admin/api/dev-tools-hooks.ts'
import { ModalScreen } from '@/features/navigation/components/modal-screen'

export const AdminSettingsView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const triggerErrorMessageMutation = useTriggerErrorMessageMutation()
  const advancePracticeClockMutation = useAdvancePracticeClockMutation()

  const handleAdvancePracticeClock = async (days: number) => {
    try {
      const result = await advancePracticeClockMutation.mutateAsync({ days })
      const shiftedRows = result.data.tables.reduce((sum, table) => sum + table.rowsShifted, 0)
      alert(`Practice clock advanced by ${days} day(s) — ${shiftedRows} rows shifted.`)
    } catch {
      // the mutation's errorMessage meta already surfaced a toast
    }
  }

  const handleTestErrorLog = () => {
    logError({
      message: 'Test error log from Admin Settings',
      error: new Error('Test handled error from Admin Settings'),
      params: {
        test: 'test',
        another_test: 'another_test',
      },
      severity: 'warning',
    })
    alert('Error monitoring test log sent!')
  }

  const handleTestUnhandledError = () => {
    alert('Unhandled error thrown and captured by error monitoring!')
    throw new Error('Test unhandled error from Admin Settings')
  }

  const handleTestBackendErrorMessage = async () => {
    try {
      await triggerErrorMessageMutation.mutateAsync({
        message: 'Test backend error message from Admin Settings',
      })
      alert('Backend test error sent!')
    } catch (error) {
      logError({ message: 'Failed to trigger the backend test error', error })
      alert('Failed to send the backend test error')
    }
  }

  return (
    <ModalScreen onClose={() => navigate({ to: '/more' })} closeIcon='chevron' title={t`Admin settings`}>
      <main className='flex flex-1 justify-center overflow-y-auto p-4'>
        <div className='w-full max-w-3xl space-y-4'>
          {/* Practice time travel: shifts this account's practice timestamps
              backward, which is equivalent to the server clock advancing —
              multi-day flows (warm-up/rehab graduation, daily-new cap resets)
              become testable in one sitting. Server-gated to test users. */}
          <Card>
            <CardHeader>
              <CardTitle>Practice time travel</CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              <p className='text-sm text-stone-600'>
                Shift your practice data back in time so day-based rules (rehab day credits, the daily new-term cap, due
                dates) behave as if the day had advanced. Only affects your own account.
              </p>
              <div className='flex flex-col gap-3 sm:flex-row'>
                <Button
                  onClick={() => handleAdvancePracticeClock(1)}
                  disabled={advancePracticeClockMutation.isPending}
                  variant='outline'
                  className='border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-400/10'
                >
                  Advance practice clock by 1 day
                </Button>
                <Button
                  onClick={() => handleAdvancePracticeClock(7)}
                  disabled={advancePracticeClockMutation.isPending}
                  variant='outline'
                  className='border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-400/10'
                >
                  Advance by 7 days
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Error monitoring testing</CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              <p className='text-sm text-stone-600'>
                Use these buttons to test PostHog error reporting in your environment.
              </p>
              <div className='flex flex-col gap-3 sm:flex-row'>
                <Button
                  onClick={handleTestErrorLog}
                  variant='outline'
                  className='border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-400/10'
                >
                  Test Frontend Error Log
                </Button>
                <Button
                  onClick={handleTestUnhandledError}
                  variant='outline'
                  className='border-destructive/40 hover:bg-destructive/10'
                >
                  Test Frontend Unhandled Error
                </Button>
                <Button
                  onClick={handleTestBackendErrorMessage}
                  variant='outline'
                  className='border-purple-300 hover:bg-purple-50'
                >
                  Test Backend Error Message
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </ModalScreen>
  )
}

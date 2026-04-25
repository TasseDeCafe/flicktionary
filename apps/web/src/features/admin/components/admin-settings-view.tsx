import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx'
import { logWithSentry } from '@/lib/analytics/log-with-sentry.ts'
import { useTriggerSentryMessageMutation } from '@/features/admin/api/sentry-debug-hooks.ts'
import { Route as profileRoute } from '@/app/routes/_authenticated/_tabs/profile'

export const AdminSettingsView = () => {
  const navigate = useNavigate()
  const triggerSentryMessageMutation = useTriggerSentryMessageMutation()

  const handleTestSentryLog = () => {
    logWithSentry({
      message: 'Test Sentry log from Admin Settings',
      error: new Error('Test Sentry error from Admin Settings'),
      params: {
        test: 'test',
        another_test: 'another_test',
      },
      severityLevel: 'warning',
    })
    alert('Sentry test log sent!')
  }

  const handleTestSentryError = () => {
    alert('Unhandled error thrown and captured by Sentry!')
    throw new Error('Test unhandled error from Admin Settings')
  }

  const handleTestBackendSentryMessage = async () => {
    try {
      await triggerSentryMessageMutation.mutateAsync({
        message: 'Test backend Sentry message from Admin Settings',
        isInfoLevel: false,
      })
      alert('Backend Sentry test message sent!')
    } catch (error) {
      logWithSentry({ message: 'Failed to trigger backend Sentry message', error })
      alert('Failed to send backend Sentry test message')
    }
  }

  return (
    <div className='flex min-h-screen flex-col'>
      {/* Header */}
      <header className='bg-background sticky top-0 z-10 flex h-14 items-center border-b px-4'>
        <button
          onClick={() => navigate({ to: profileRoute.to })}
          className='flex h-10 w-10 items-center justify-center rounded-lg hover:bg-gray-100'
        >
          <ArrowLeft className='h-6 w-6' />
        </button>
        <h1 className='ml-2 text-lg font-semibold'>Admin Settings</h1>
      </header>

      {/* Main content */}
      <main className='flex flex-1 justify-center p-4'>
        <div className='w-full max-w-3xl'>
          <Card>
            <CardHeader>
              <CardTitle>Sentry Testing</CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              <p className='text-sm text-stone-600'>
                Use these buttons to test Sentry error reporting in your environment.
              </p>
              <div className='flex flex-col gap-3 sm:flex-row'>
                <Button onClick={handleTestSentryLog} variant='outline' className='border-blue-300 hover:bg-blue-50'>
                  Test Frontend Sentry Log
                </Button>
                <Button onClick={handleTestSentryError} variant='outline' className='border-red-300 hover:bg-red-50'>
                  Test Frontend Unhandled Error
                </Button>
                <Button
                  onClick={handleTestBackendSentryMessage}
                  variant='outline'
                  className='border-purple-300 hover:bg-purple-50'
                >
                  Test Backend Sentry Message
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}

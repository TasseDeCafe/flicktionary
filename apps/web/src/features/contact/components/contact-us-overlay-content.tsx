import {
  OverlayContent,
  OverlayDescription,
  OverlayHeader,
  OverlayTitle,
  useCloseOverlay,
} from '@/components/ui/responsive-overlay'
import { Loader2, Send } from 'lucide-react'
import { Textarea } from '@flicktionary/ui/components/textarea'
import { Input } from '@flicktionary/ui/components/input'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@flicktionary/ui/components/form'
import { z } from 'zod'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { formSchema } from '@flicktionary/api-client/orpc-contracts/contact-email-contract'
import { useSendContactEmail } from '@/features/contact/api/contact-hooks'
import { useLingui } from '@lingui/react/macro'
import { useAuthStore, getUserEmail, getUserName } from '@/stores/auth-store'
import { Button } from '@flicktionary/ui/components/button'

export const ContactUsOverlayContent = () => {
  const { t } = useLingui()

  const userEmail = useAuthStore(getUserEmail)
  const username = useAuthStore(getUserName)
  const closeOverlay = useCloseOverlay()

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      username: username || '',
      email: userEmail || '',
      message: '',
    },
  })

  const {
    mutate: sendEmail,
    isPending,
    isError,
    isSuccess,
  } = useSendContactEmail({
    onSuccess: () => {
      form.reset()
      closeOverlay()
    },
  })

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    sendEmail(values)
  }

  return (
    <OverlayContent>
      <OverlayHeader>
        <OverlayTitle>{t`Help us improve Flicktionary`}</OverlayTitle>
        <p className='text-muted-foreground text-sm'>{t`Share your feedback or suggest improvements to the founders. We read and reply to every submission!`}</p>
        <OverlayDescription className='hidden'></OverlayDescription>
      </OverlayHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className='mt-4 space-y-4'>
          <FormField
            control={form.control}
            name='message'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t`Message to the founders`}</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    placeholder={t`Tell us what you think or describe any issues you encountered...`}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='email'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t`Email`}</FormLabel>
                <FormControl>
                  <Input {...field} type='email' placeholder={t`your@email.com`} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='username'
            render={({ field }) => (
              <FormItem className='pb-4'>
                <FormLabel>{t`Name (optional)`}</FormLabel>
                <FormControl>
                  <Input {...field} placeholder={t`Your name`} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className='flex justify-end gap-3'>
            <Button variant='outline' onClick={() => closeOverlay()} type='button'>
              {t`Cancel`}
            </Button>
            <Button
              type='submit'
              disabled={isPending}
              className={cn({
                'bg-muted-foreground cursor-not-allowed': isPending || isSuccess,
                'bg-destructive hover:bg-destructive/90': isError,
              })}
            >
              {isPending ? (
                <>
                  <Loader2 className='mr-2 inline h-4 w-4 animate-spin' />
                  {t`Sending...`}
                </>
              ) : isError ? (
                t`An error occurred. Please try again.`
              ) : (
                <>
                  <Send className='mr-2 inline h-4 w-4' />
                  {t`Send Message`}
                </>
              )}
            </Button>
          </div>
        </form>
      </Form>
    </OverlayContent>
  )
}

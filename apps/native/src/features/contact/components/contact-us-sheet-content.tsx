import { useState } from 'react'
import { Text } from 'react-native'
import { BottomSheetScrollView, BottomSheetTextInput } from '@/components/ui/styled'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import * as Haptics from 'expo-haptics'

import { Button } from '@/components/ui/button'
import { useSendContactEmail } from '@/features/contact/api/contact-hooks'
import { useAuthStore } from '@/stores/auth-store'
import { formSchema } from '@template-app/api-client/orpc-contracts/contact-email-contract'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLingui } from '@lingui/react/macro'

interface ContactUsSheetContentProps {
  close: () => void
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const ContactUsSheetContent = ({ close }: ContactUsSheetContentProps) => {
  const { t } = useLingui()

  const session = useAuthStore((state) => state.session)
  const userEmail = session?.user?.email
  const username = session?.user?.user_metadata?.name
  const insets = useSafeAreaInsets()

  const {
    control,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      username: username || '',
      email: userEmail || '',
      message: '',
    },
  })

  const [showSuccessState, setShowSuccessState] = useState(false)

  const {
    mutate: sendEmail,
    isPending,
    isError,
  } = useSendContactEmail({
    meta: {
      showSuccessToast: false,
      showErrorToast: false,
    },
  })

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    sendEmail(values, {
      onSuccess: async () => {
        setShowSuccessState(true)
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).then()
        await wait(1500)
        reset()
        close()
        setShowSuccessState(false)
      },
      onError: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).then()
      },
    })
  }

  return (
    <BottomSheetScrollView
      className='px-6 pt-4'
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) }}
      keyboardShouldPersistTaps='handled'
    >
      <Text className='mb-2 text-center text-2xl font-semibold'>{t`Help us improve TemplateApp`}</Text>
      <Text className='mb-6 text-center text-gray-500'>{t`Share your feedback or suggest improvements to the founders. We read and reply to every submission!`}</Text>
      <Text className='mb-1 text-sm font-medium text-gray-700'>{t`Message to the founders`}</Text>
      <Controller
        control={control}
        name='message'
        render={({ field: { onChange, onBlur, value } }) => (
          <BottomSheetTextInput
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            placeholder={t`Tell us what you think or describe any issues you encountered...`}
            multiline
            numberOfLines={5}
            className='mb-1 min-h-[100px] rounded-lg border border-gray-300 bg-white p-3 text-base leading-5'
            textAlignVertical='top'
          />
        )}
      />
      {errors.message && <Text className='mb-4 text-sm text-red-500'>{errors.message.message}</Text>}
      <Text className='mt-4 mb-1 text-sm font-medium text-gray-700'>{t`Email`}</Text>
      <Controller
        control={control}
        name='email'
        render={({ field: { onChange, onBlur, value } }) => (
          <BottomSheetTextInput
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            placeholder={t`your@email.com`}
            keyboardType='email-address'
            autoCapitalize='none'
            className='border-input mb-1 h-16 rounded-lg border border-gray-300 bg-white p-3 text-base leading-5'
            returnKeyType='done'
          />
        )}
      />
      {errors.email && <Text className='mb-4 text-sm text-red-500'>{errors.email.message}</Text>}
      <Text className='mt-4 mb-1 text-sm font-medium text-gray-700'>{t`Name (optional)`}</Text>
      <Controller
        control={control}
        name='username'
        render={({ field: { onChange, onBlur, value } }) => (
          <BottomSheetTextInput
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            placeholder={t`Your name`}
            autoCapitalize='words'
            returnKeyType='done'
            className='border-input mb-1 h-16 rounded-lg border border-gray-300 bg-white p-3 text-base leading-5'
          />
        )}
      />
      {errors.username && <Text className='mb-4 text-sm text-red-500'>{errors.username.message}</Text>}
      <Button
        onPress={handleSubmit(onSubmit)}
        className={`mt-6 ${showSuccessState ? 'bg-green-500' : isError ? 'bg-red-500' : ''}`}
        variant={showSuccessState ? 'default' : isPending ? 'inactive' : isError ? 'destructive' : 'default'}
        disabled={isPending || showSuccessState}
        loading={isPending}
      >
        {isPending
          ? t`Sending...`
          : showSuccessState
            ? t`Thank you for your feedback!`
            : isError
              ? t`An error occurred. Please try again.`
              : t`Send Message`}
      </Button>
      <Button variant='outline' onPress={close} disabled={isPending || showSuccessState} className='mt-3 mb-4'>
        {t`Cancel`}
      </Button>
    </BottomSheetScrollView>
  )
}

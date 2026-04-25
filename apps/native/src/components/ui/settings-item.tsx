import { Pressable, Text, View } from 'react-native'
import { cn } from '@template-app/core/utils/tailwind-utils'
import { ChevronRight } from 'lucide-react-native'
import { ReactNode } from 'react'
import { colors } from '@/constants/colors'

export const SettingsItem = ({
  title,
  value,
  onPress,
  variant = 'default',
  className,
  textClassName,
  disabled,
}: {
  title: ReactNode
  value: ReactNode
  onPress: () => void
  variant?: 'default' | 'destructive'
  className?: string
  textClassName?: string
  disabled?: boolean
}) => {
  const textVariants = {
    default: 'text-lg font-medium',
    destructive: 'text-lg font-medium text-red-600',
  }

  const chevronColors = {
    default: colors.gray[400],
    destructive: colors.red[500],
  }

  const currentTextColor = disabled
    ? 'text-gray-400'
    : variant === 'destructive'
      ? textVariants.destructive
      : textVariants.default

  const currentValueColor = disabled ? 'text-gray-400' : 'text-gray-500'
  const currentChevronColor = disabled ? colors.gray[300] : chevronColors[variant]

  return (
    <Pressable onPress={onPress} className={cn(`flex-row items-center justify-between px-2 py-4`, className)}>
      {({ pressed }) => (
        <View
          style={{ opacity: disabled ? 1 : pressed ? 0.5 : 1 }}
          className='flex-1 flex-row items-center justify-between'
        >
          {typeof title === 'string' || typeof title === 'number' ? (
            <Text className={cn(currentTextColor, textClassName, 'text-lg font-medium')}>{title}</Text>
          ) : (
            <View className='flex-row items-center'>{title}</View>
          )}
          <View className='flex-row items-center py-1'>
            {['string', 'number'].includes(typeof value) ? (
              <Text className={cn('mr-2 text-lg', currentValueColor)}>{value}</Text>
            ) : (
              <View className='mr-2'>{value}</View>
            )}
            <ChevronRight size={20} color={currentChevronColor} />
          </View>
        </View>
      )}
    </Pressable>
  )
}

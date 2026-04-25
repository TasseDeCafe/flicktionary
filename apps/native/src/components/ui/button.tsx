import { ActivityIndicator, Text, TouchableOpacity, TouchableOpacityProps, View } from 'react-native'
import { cn } from '@template-app/core/utils/tailwind-utils'
import { colors } from '@/constants/colors'
import { ReactNode } from 'react'

interface ButtonProps extends TouchableOpacityProps {
  variant?: 'default' | 'white' | 'outline' | 'destructive' | 'inactive' | 'ghost'
  size?: 'default' | 'lg'
  className?: string
  textClassName?: string
  loading?: boolean
  startIcon?: ReactNode
  children: ReactNode
}

// note: for some reason overriding some styles with className in the component
// makes it flicker. Prefer using a variant defined here until this is figured out
export const Button = ({
  variant = 'default',
  size = 'default',
  className,
  textClassName,
  loading = false,
  startIcon,
  children,
  disabled,
  ...props
}: ButtonProps) => {
  const baseStyles = 'flex-row items-center justify-center rounded-xl'

  const variants = {
    default: 'bg-black',
    white: 'bg-white border border-gray-300',
    outline: 'border border-gray-300 bg-transparent',
    destructive: 'bg-red-500',
    inactive: 'bg-gray-300',
    ghost: 'bg-transparent',
  }

  const sizes = {
    default: 'px-4 py-2 h-16',
    lg: 'px-4 py-4',
  }

  const textVariants = {
    default: 'text-white font-medium text-xl',
    white: 'text-gray-700 font-medium text-xl',
    outline: 'text-gray-700 font-medium text-xl',
    destructive: 'text-white font-medium text-xl',
    inactive: 'text-gray-500 font-medium text-xl',
    ghost: 'text-gray-700 font-medium text-xl',
  }

  const spinnerColor =
    variant === 'default' || variant === 'destructive'
      ? 'white'
      : variant === 'inactive'
        ? colors.gray[400]
        : colors.black

  const isDisabled = disabled || loading
  const opacityStyle = isDisabled && variant !== 'inactive' ? 'opacity-70' : 'opacity-100'

  return (
    <TouchableOpacity
      className={cn(baseStyles, variants[variant], sizes[size], opacityStyle, className)}
      disabled={isDisabled}
      {...props}
    >
      <View
        style={{
          minHeight: size === 'lg' ? 28 : 20,
          justifyContent: 'center',
          alignItems: 'center',
          flexDirection: 'row',
          gap: startIcon ? 8 : 0,
        }}
      >
        {loading ? (
          <ActivityIndicator color={spinnerColor} size='small' />
        ) : (
          <>
            {startIcon}
            <Text className={cn(textVariants[variant], textClassName)}>{children}</Text>
          </>
        )}
      </View>
    </TouchableOpacity>
  )
}

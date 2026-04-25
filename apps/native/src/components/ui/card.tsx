import { View, ViewProps } from 'react-native'
import { cn } from '@template-app/core/utils/tailwind-utils'
import { ReactNode } from 'react'

interface CardProps extends ViewProps {
  children: ReactNode
  className?: string
}

export const Card = ({ children, className, ...props }: CardProps) => {
  return (
    <View className={cn('rounded-xl bg-white p-4', className)} {...props}>
      {children}
    </View>
  )
}

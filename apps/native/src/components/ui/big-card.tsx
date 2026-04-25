import React, { ReactNode } from 'react'
import { View } from 'react-native'
import { cn } from '@template-app/core/utils/tailwind-utils'

interface BigCardProps {
  children: ReactNode
  className?: string
}

export const BigCard = ({ children, className = '' }: BigCardProps) => {
  return <View className={cn('w-full flex-col rounded-2xl bg-white p-2', className)}>{children}</View>
}

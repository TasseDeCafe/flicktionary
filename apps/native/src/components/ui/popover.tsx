import * as PopoverPrimitive from '@rn-primitives/popover'
import * as React from 'react'
import { Platform, StyleSheet } from 'react-native'
import Animated, { ZoomIn, ZoomOut } from 'react-native-reanimated'
import { cn } from '@template-app/core/utils/tailwind-utils'
import { TextClassContext } from './react-native-reusables/text'

const Popover = PopoverPrimitive.Root

const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverContent = React.forwardRef<
  PopoverPrimitive.ContentRef,
  PopoverPrimitive.ContentProps & { portalHost?: string; children?: React.ReactNode }
>(({ className, align = 'center', sideOffset = 4, portalHost, children, ...props }, ref) => {
  return (
    <PopoverPrimitive.Portal hostName={portalHost}>
      <PopoverPrimitive.Overlay style={StyleSheet.absoluteFill}>
        <PopoverPrimitive.Content
          ref={ref}
          align={align}
          sideOffset={sideOffset}
          avoidCollisions={true}
          className={cn('z-50', className)}
          {...props}
        >
          <Animated.View
            entering={ZoomIn.duration(100)}
            exiting={ZoomOut.duration(100)}
            className={cn(
              'max-w-80 min-w-40 rounded-xl border border-gray-200 bg-white p-4',
              Platform.select({
                ios: 'shadow-xl shadow-gray-200',
                android: 'shadow-xl shadow-gray-600',
              })
            )}
          >
            <TextClassContext.Provider value='text-popover-foreground'>{children}</TextClassContext.Provider>
          </Animated.View>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Overlay>
    </PopoverPrimitive.Portal>
  )
})
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverContent, PopoverTrigger }

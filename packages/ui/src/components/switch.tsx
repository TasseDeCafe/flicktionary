import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '@flicktionary/core/utils/tailwind-utils'

const Switch = ({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) => (
  <SwitchPrimitive.Root
    data-slot='switch'
    className={cn(
      // Track height is px, not the upstream 1.15rem: rem resolves against the
      // HOST page root font-size inside the extension's shadow surfaces
      // (YouTube's 10px root squashed the track below its own 16px thumb).
      // 18.4px == 1.15rem at the default 16px root, so web is pixel-identical.
      'peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:border-ring focus-visible:ring-ring/50 dark:data-[state=unchecked]:bg-input/80 inline-flex h-[18.4px] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
      className
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      data-slot='switch-thumb'
      className={cn(
        'bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0'
      )}
    />
  </SwitchPrimitive.Root>
)

export { Switch }

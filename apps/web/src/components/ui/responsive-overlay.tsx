'use client'

import * as React from 'react'
import { createContext, useContext } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { useIsMobile } from '@/hooks/use-is-mobile'

// Context to share mobile state and close function with child components
interface OverlayContextValue {
  isMobile: boolean
  closeOverlay: () => void
}

const OverlayContext = createContext<OverlayContextValue | null>(null)

const useOverlayContext = () => {
  const context = useContext(OverlayContext)
  if (!context) {
    throw new Error('Overlay components must be used within a ResponsiveOverlay')
  }
  return context
}

export const useCloseOverlay = () => {
  const { closeOverlay } = useOverlayContext()
  return closeOverlay
}

// Root component that renders either Dialog or Drawer
interface ResponsiveOverlayProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}

export const ResponsiveOverlay = ({ open, onOpenChange, children }: ResponsiveOverlayProps) => {
  const isMobile = useIsMobile()

  // Don't render until we know the screen size to avoid hydration mismatch
  if (isMobile === undefined) {
    return null
  }

  const closeOverlay = () => onOpenChange(false)

  return (
    <OverlayContext.Provider value={{ isMobile, closeOverlay }}>
      {isMobile ? (
        <Drawer open={open} repositionInputs={false} onOpenChange={onOpenChange}>
          {children}
        </Drawer>
      ) : (
        <Dialog open={open} onOpenChange={onOpenChange}>
          {children}
        </Dialog>
      )}
    </OverlayContext.Provider>
  )
}

// Content wrapper that renders DialogContent or DrawerContent
interface OverlayContentProps {
  className?: string
  children: React.ReactNode
  showCloseButton?: boolean
}

export const OverlayContent = ({ className, children, showCloseButton = true }: OverlayContentProps) => {
  const { isMobile } = useOverlayContext()

  if (isMobile) {
    return <DrawerContent className={className}>{children}</DrawerContent>
  }

  return (
    <DialogContent className={className} showCloseButton={showCloseButton}>
      {children}
    </DialogContent>
  )
}

// Header wrapper
interface OverlayHeaderProps {
  className?: string
  children: React.ReactNode
}

export const OverlayHeader = ({ className, children }: OverlayHeaderProps) => {
  const { isMobile } = useOverlayContext()

  if (isMobile) {
    return <DrawerHeader className={className}>{children}</DrawerHeader>
  }

  return <DialogHeader className={className}>{children}</DialogHeader>
}

// Title wrapper
interface OverlayTitleProps {
  className?: string
  children: React.ReactNode
}

export const OverlayTitle = ({ className, children }: OverlayTitleProps) => {
  const { isMobile } = useOverlayContext()

  if (isMobile) {
    return <DrawerTitle className={className}>{children}</DrawerTitle>
  }

  return <DialogTitle className={className}>{children}</DialogTitle>
}

// Description wrapper
interface OverlayDescriptionProps {
  className?: string
  children?: React.ReactNode
}

export const OverlayDescription = ({ className, children }: OverlayDescriptionProps) => {
  const { isMobile } = useOverlayContext()

  if (isMobile) {
    return <DrawerDescription className={className}>{children}</DrawerDescription>
  }

  return <DialogDescription className={className}>{children}</DialogDescription>
}

// Footer wrapper
interface OverlayFooterProps {
  className?: string
  children: React.ReactNode
}

export const OverlayFooter = ({ className, children }: OverlayFooterProps) => {
  const { isMobile } = useOverlayContext()

  if (isMobile) {
    return <DrawerFooter className={className}>{children}</DrawerFooter>
  }

  return <DialogFooter className={className}>{children}</DialogFooter>
}

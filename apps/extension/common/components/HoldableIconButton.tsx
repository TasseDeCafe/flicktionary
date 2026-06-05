import React, { useCallback, useEffect, useState } from 'react'

interface Props extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  onHold?: (repetition: number) => void
  onClick: () => void
  children: React.ReactNode
}

// Press-and-hold button: a press shorter than one 250ms repetition is a click;
// anything longer fires `onHold` every 250ms until release. Pointer capture
// keeps the release event on the button even when the pointer wanders off it
// mid-hold (the old mouseup-on-button version kept repeating forever in that
// case), and pointercancel/blur stop the hold too.
const HoldableIconButton = ({ onHold, onClick, children, ...rest }: Props) => {
  const [startTime, setStartTime] = useState<number>()

  const repetitions = useCallback(() => {
    if (startTime === undefined) {
      return undefined
    }

    const holdTime = Date.now() - startTime
    return holdTime / 250
  }, [startTime])

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setStartTime(Date.now())
  }

  const handlePointerUp = () => {
    const reps = repetitions()

    if (reps !== undefined && reps < 1) {
      onClick?.()
    }

    setStartTime(undefined)
  }

  const handlePointerCancel = () => {
    setStartTime(undefined)
  }

  useEffect(() => {
    if (startTime === undefined) {
      return
    }

    const interval = setInterval(() => {
      const reps = repetitions()

      if (reps !== undefined && reps > 0) {
        onHold?.(reps)
      }
    }, 250)
    return () => clearInterval(interval)
  }, [startTime, onHold, repetitions])

  return (
    <button
      type='button'
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onBlur={handlePointerCancel}
      {...rest}
    >
      {children}
    </button>
  )
}

export default HoldableIconButton

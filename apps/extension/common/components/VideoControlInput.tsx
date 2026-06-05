import React, { MutableRefObject, useCallback, useEffect, useState } from 'react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'

interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  inputRef: MutableRefObject<HTMLInputElement | undefined>
  numberValue: number
  defaultNumberValue: number
  onNumberValue: (value: number) => void
  valueToPrettyString: (value: number) => string
  stringToValue: (stringValue: string) => number
  rejectValue?: (value: number) => boolean
  disableKeyEvents?: boolean
}

// Imperative number input for the controls overlay (offset / playback rate):
// the value is written straight into the input element (not React state) so the
// controller's model pushes don't fight an in-progress edit, and the input
// blurs after every apply. Width tracks content in `ch` so the overlay bar
// stays compact.
export default function VideoControlInput({
  inputRef,
  numberValue,
  defaultNumberValue,
  onNumberValue,
  valueToPrettyString,
  stringToValue,
  rejectValue,
  disableKeyEvents,
  className,
  ...rest
}: Props) {
  const [inputWidth, setInputWidth] = useState<number>(5)
  const handleNumberInputClicked = useCallback((e: React.MouseEvent<HTMLInputElement>) => {
    const inputElement = e.target as HTMLInputElement
    inputElement.setSelectionRange(0, inputElement.value?.length || 0)
  }, [])

  const updateValue = useCallback(
    (value: number, publish: boolean) => {
      if (!inputRef.current) {
        return
      }

      if (value === defaultNumberValue) {
        inputRef.current.value = ''
        setInputWidth(5)
      } else {
        if (publish) {
          onNumberValue(value)
        }

        const stringValue = valueToPrettyString(value)
        inputRef.current.value = stringValue
        setInputWidth(stringValue.length)
      }

      inputRef.current.blur()
    },
    [inputRef, valueToPrettyString, onNumberValue, defaultNumberValue]
  )

  const tryApplyValue = useCallback(
    (revertOnFailure: boolean) => {
      if (!inputRef.current) {
        return
      }

      const newValue = stringToValue(inputRef.current.value)

      if (newValue === numberValue) {
        updateValue(numberValue, true)
        return
      }

      if (Number.isNaN(newValue) || rejectValue?.(newValue)) {
        if (revertOnFailure) {
          updateValue(numberValue, true)
        }
        return
      }

      onNumberValue(newValue)
    },
    [updateValue, stringToValue, onNumberValue, rejectValue, numberValue, inputRef]
  )

  const handleNumberInputDeselected = useCallback(() => {
    tryApplyValue(true)
  }, [tryApplyValue])

  useEffect(() => {
    updateValue(numberValue, false)
  }, [numberValue, updateValue])

  useEffect(() => {
    if (disableKeyEvents) {
      return
    }

    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Enter' && inputRef.current !== null && inputRef.current === document.activeElement) {
        tryApplyValue(false)
      }
    }

    window.addEventListener('keydown', handleKey)

    return () => {
      window.removeEventListener('keydown', handleKey)
    }
  }, [tryApplyValue, disableKeyEvents, inputRef])

  return (
    <input
      style={{
        width: `${inputWidth}ch`,
      }}
      ref={(el) => {
        inputRef.current = el ?? undefined
      }}
      className={cn(
        'pointer-events-auto h-full border-none bg-transparent text-center text-[20px] text-white outline-none placeholder:text-white/70',
        className
      )}
      onClick={handleNumberInputClicked}
      onBlur={handleNumberInputDeselected}
      onChange={(e) => setInputWidth(Math.max(5, e.target.value.length))}
      {...rest}
    />
  )
}

import { useCallback, useEffect, useState } from 'react'
import { ControlType } from '..'

interface Params {
  fetchLastControlType: () => Promise<ControlType | undefined>
  saveLastControlType: (controlType: ControlType) => void
}

export const useLastScrollableControlType = ({ fetchLastControlType, saveLastControlType }: Params) => {
  const defaultControlType = ControlType.subtitleOffset
  const [lastControlType, setLastControlType] = useState<ControlType>(defaultControlType)

  useEffect(() => {
    fetchLastControlType().then((controlType) => {
      if (controlType === undefined) {
        setLastControlType(defaultControlType)
      } else {
        setLastControlType(controlType)
      }
    })
  }, [defaultControlType, fetchLastControlType])

  const wrapSaveLastControlType = useCallback(
    (controlType: ControlType) => {
      setLastControlType(controlType)
      saveLastControlType(controlType)
    },
    [saveLastControlType]
  )

  return { lastControlType, setLastControlType: wrapSaveLastControlType }
}

export default useLastScrollableControlType

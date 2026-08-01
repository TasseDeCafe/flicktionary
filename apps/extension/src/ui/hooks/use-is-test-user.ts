import { useEffect, useState } from 'react'
import { getFlicktionaryAuth, onFlicktionaryAuthChange } from '@/services/flicktionary/auth-storage'
import { checkIsTestUser } from '@/services/flicktionary/test-users'

/**
 * Whether the currently paired Flicktionary account belongs to a test
 * user/admin (hashed-email allow-list). False while unpaired or resolving;
 * tracks pair/unpair live.
 */
export const useIsTestUser = (): boolean => {
  const [isTestUser, setIsTestUser] = useState(false)

  useEffect(() => {
    let active = true

    const resolve = async (email: string | null | undefined) => {
      const result = email ? await checkIsTestUser(email) : false
      if (active) setIsTestUser(result)
    }

    void getFlicktionaryAuth().then((auth) => resolve(auth?.email))
    const unsubscribe = onFlicktionaryAuthChange((auth) => void resolve(auth?.email))

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return isTestUser
}

'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

const ClearDataPage = () => {
  const router = useRouter()

  useEffect(() => {
    localStorage.clear()
    router.push('/yba-admin')
  }, [router])

  return <div className='p-4'>Clearing data...</div>
}

export default ClearDataPage

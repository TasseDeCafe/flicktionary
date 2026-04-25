'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

const AdminPage = () => {
  const [localStorageData, setLocalStorageData] = useState<Record<string, string>>({})
  const [userAgent, setUserAgent] = useState<string>('')

  useEffect(() => {
    const data: Record<string, string> = {}
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key) {
        data[key] = localStorage.getItem(key) || ''
      }
    }
    setUserAgent(window.navigator.userAgent)
    setLocalStorageData(data)
  }, [])

  return (
    <div className='intems-center flex flex-col gap-y-4 p-4'>
      <h1 className='mb-4 text-2xl font-bold'>navigator.userAgent</h1>
      <pre className='rounded bg-gray-100 p-4'>{JSON.stringify(userAgent, null, 2)}</pre>
      <h1 className='mb-4 text-2xl font-bold'>Local Storage Data</h1>
      <pre className='rounded bg-gray-100 p-4'>{JSON.stringify(localStorageData, null, 2)}</pre>
      <Link
        href='/yba-admin/clear-data'
        className='h-24 w-60 cursor-pointer rounded-xl bg-indigo-600 px-6 py-2 text-center text-white'
        aria-hidden='true'
      >
        clear local storage
      </Link>
    </div>
  )
}

export default AdminPage

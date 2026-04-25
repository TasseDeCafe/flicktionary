import { Metadata } from 'next'
import '../[lang]/globals.css'

export const metadata: Metadata = {
  robots: 'noindex,nofollow',
}

const AdminLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <html lang='en' className=''>
      <body className='flex h-dvh w-full flex-col justify-between bg-gray-50'>{children}</body>
    </html>
  )
}

export default AdminLayout

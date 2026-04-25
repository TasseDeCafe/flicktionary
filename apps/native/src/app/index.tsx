import { Redirect } from 'expo-router'
import { useAuthStore } from '@/stores/auth-store'

export default function Index() {
  const session = useAuthStore((state) => state.session)
  const isSignedIn = !!session

  if (isSignedIn) {
    return <Redirect href='/home' />
  }

  return <Redirect href='/login' />
}

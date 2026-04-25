import { View } from 'react-native'
import { Link, Stack } from 'expo-router'
import { ROUTE_PATHS } from '@/constants/route-paths'

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Oops! Not Found' }} />
      <View className='flex-1 items-center justify-center bg-slate-800'>
        <Link href={ROUTE_PATHS.LOGIN} className='text-xl text-white underline'>
          Go back to Home screen!
        </Link>
      </View>
    </>
  )
}

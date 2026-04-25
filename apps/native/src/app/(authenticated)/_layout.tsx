import { Stack } from 'expo-router'
import { RevenuecatInitializer } from '@/features/auth/components/revenuecat-initializer'
import { ForceUpdateGate } from '@/components/gates/force-update-gate'

const AuthenticatedLayout = () => {
  return (
    <RevenuecatInitializer>
      <ForceUpdateGate>
        <Stack
          screenOptions={{
            headerShown: false,
            headerShadowVisible: false,
            animation: 'slide_from_right',
            headerTitleAlign: 'center',
          }}
        />
      </ForceUpdateGate>
    </RevenuecatInitializer>
  )
}

export default AuthenticatedLayout

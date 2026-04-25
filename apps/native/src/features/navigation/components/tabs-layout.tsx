import { Tabs } from 'expo-router'
import { CircleUserRound, Dumbbell, Home } from 'lucide-react-native'
import { colors } from '@/constants/colors'
import { useBottomSheetStore } from '@/features/sheets/stores/bottom-sheet-store'
import { SheetId } from '@/features/sheets/components/bottom-sheet-ids'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Pressable, Text, TouchableOpacity } from 'react-native'
import { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs'
import { TAB_BAR_CONTENT_AREA_HEIGHT, TAB_BAR_PADDING_ABOVE_INSET, TAB_BAR_PADDING_TOP } from '@/constants/tabs-layout'
import { useLingui } from '@lingui/react/macro'

const CustomTabBarButton = (props: BottomTabBarButtonProps) => {
  const { children, onPress } = props

  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: colors.yellow[100], borderless: true }}
      className='flex-1 items-center justify-center'
    >
      {children}
    </Pressable>
  )
}

export const TabsLayout = () => {
  const { t } = useLingui()

  const openSheet = useBottomSheetStore((state) => state.open)
  const { bottom: bottomInset } = useSafeAreaInsets()

  const calculatedPaddingBottom = bottomInset + TAB_BAR_PADDING_ABOVE_INSET
  const calculatedHeight = TAB_BAR_CONTENT_AREA_HEIGHT + TAB_BAR_PADDING_TOP + calculatedPaddingBottom

  const handleContactUsPress = () => {
    openSheet(SheetId.CONTACT_US)
  }

  return (
    <Tabs
      screenOptions={{
        // this undocumented prop is used to set the style of the individual screens
        sceneStyle: { backgroundColor: colors.white },
        headerShown: true,
        tabBarActiveTintColor: colors.yellow[500],
        tabBarInactiveTintColor: colors.gray[500],
        headerStyle: {
          backgroundColor: colors.white,
          height: 105,
        },
        headerShadowVisible: false,
        headerTintColor: colors.black,
        tabBarStyle: {
          elevation: 10,
          borderTopWidth: 0,
          height: calculatedHeight,
          paddingBottom: calculatedPaddingBottom,
          paddingTop: TAB_BAR_PADDING_TOP,
          marginHorizontal: 0,
          marginBottom: 0,
          backgroundColor: 'white',
          position: 'absolute',
          borderTopLeftRadius: 30,
          borderTopRightRadius: 30,
          bottom: 0,
          left: 0,
          right: 0,
          shadowColor: '#000',
          shadowOpacity: 0.1,
          shadowRadius: 4,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '500',
        },
        headerTitleAlign: 'center',
        tabBarShowLabel: true,
        tabBarButton: (props) => <CustomTabBarButton {...props} />,
        headerRight: () => (
          <TouchableOpacity
            onPress={handleContactUsPress}
            className='mr-4 flex h-10 flex-row items-center justify-center rounded-xl bg-black px-4'
          >
            <Text className='text-sm font-medium text-white'>{t`Contact Us`}</Text>
          </TouchableOpacity>
        ),
      }}
    >
      <Tabs.Screen
        name='home'
        options={{
          title: t`Home`,
          tabBarIcon: ({ color }) => <Home size={24} color={color} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name='dashboard'
        options={{
          title: t`Dashboard`,
          tabBarIcon: ({ color }) => <Dumbbell size={24} color={color} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name='profile'
        options={{
          title: t`Profile`,
          tabBarIcon: ({ color }) => <CircleUserRound size={24} color={color} strokeWidth={2} />,
        }}
      />
    </Tabs>
  )
}

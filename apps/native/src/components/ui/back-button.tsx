import { TouchableOpacity } from 'react-native'
import { ChevronLeft } from 'lucide-react-native'
import { useNavigation } from 'expo-router'

export const BackButton = () => {
  const navigation = useNavigation()

  const handleBack = () => {
    navigation.goBack()
  }

  return (
    <TouchableOpacity onPress={handleBack} className='h-9 w-9 items-center justify-center'>
      <ChevronLeft size={32} color='#000' />
    </TouchableOpacity>
  )
}

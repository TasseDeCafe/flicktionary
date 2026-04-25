import 'react-native-url-polyfill/auto'
import { createClient, SupportedStorage } from '@supabase/supabase-js'
import { createMMKV } from 'react-native-mmkv'
import { getConfig } from '@/config/environment-config'

const MMKSupabaseStorage = createMMKV({ id: 'supabase-storage' })

const mmkvSupabaseSupportedStorage = {
  setItem: (key, data) => MMKSupabaseStorage.set(key, data),
  getItem: (key) => MMKSupabaseStorage.getString(key) ?? null,
  removeItem: (key) => {
    MMKSupabaseStorage.remove(key)
  },
} satisfies SupportedStorage

const supabaseProjectUrl = getConfig().supabaseProjectUrl
const supabasePublishableKey = getConfig().supabasePublishableKey

export const supabaseClient = createClient(supabaseProjectUrl, supabasePublishableKey, {
  auth: {
    // This config is taken directly from the Expo docs: https://docs.expo.dev/guides/using-supabase/
    storage: mmkvSupabaseSupportedStorage,
    detectSessionInUrl: false,
  },
})

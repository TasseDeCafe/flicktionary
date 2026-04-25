import { createClient } from '@supabase/supabase-js'
import { getConfig } from '../../config/environment-config'
import { Database } from './database.public.types'

let supabase: ReturnType<typeof createClient<Database>>

export const getSupabase = () => {
  if (!supabase) {
    supabase = createClient<Database>(getConfig().supabaseProjectUrl, getConfig().supabaseSecretKey)
  }
  return supabase
}

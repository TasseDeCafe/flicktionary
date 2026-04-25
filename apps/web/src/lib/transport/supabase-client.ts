import { createClient } from '@supabase/supabase-js'
import { getConfig } from '@/config/environment-config'

const supabaseProjectUrl = getConfig().supabaseProjectUrl
const supabasePublishableKey = getConfig().supabasePublishableKey

export const supabaseClient = createClient(supabaseProjectUrl, supabasePublishableKey)

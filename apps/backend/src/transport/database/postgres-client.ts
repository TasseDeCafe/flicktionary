import postgres from 'postgres'
import { getConfig } from '../../config/environment-config'

export const sql: postgres.Sql = postgres(getConfig().supabaseConnectionString)

import postgres from 'postgres'
import { DB_URL } from './env.mjs'

export const connectDb = () => postgres(DB_URL, { onnotice: () => {} })

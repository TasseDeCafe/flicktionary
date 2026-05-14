import type { ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import { createORPCClient } from '@orpc/client'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { getConfig } from '@/config/environment-config'
import { useAuthStore } from '@/stores/auth-store'
import { rootOrpcContract } from '@flicktionary/api-client/orpc-contracts/root-contract'
import { supabaseClient } from '@/lib/transport/supabase-client'

const apiPrefix = '/api/v1'
const hostWithPrefix = `${getConfig().apiHost}${apiPrefix}`

const link = new OpenAPILink(rootOrpcContract, {
  url: hostWithPrefix,
  headers: async () => {
    const { data, error } = await supabaseClient.auth.getSession()

    if (error || !data.session?.access_token) {
      return {}
    }

    useAuthStore.getState().setSession(data.session)

    return { Authorization: `Bearer ${data.session.access_token}` }
  },
})

const orpcClient = createORPCClient(link) as JsonifiedClient<ContractRouterClient<typeof rootOrpcContract>>

export const orpcQuery = createTanstackQueryUtils(orpcClient)

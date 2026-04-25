import type { ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import { createORPCClient } from '@orpc/client'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { getConfig } from '@/config/environment-config'
import { useAuthStore, getAccessToken } from '@/stores/auth-store'
import { rootOrpcContract } from '@template-app/api-client/orpc-contracts/root-contract'

const apiPrefix = '/api/v1'
const hostWithPrefix = `${getConfig().apiHost}${apiPrefix}`

const link = new OpenAPILink(rootOrpcContract, {
  url: hostWithPrefix,
  headers: () => {
    const state = useAuthStore.getState()
    const accessToken = getAccessToken(state)

    if (accessToken) {
      return { Authorization: `Bearer ${accessToken}` }
    }

    return {}
  },
})

const orpcClient = createORPCClient(link) as JsonifiedClient<ContractRouterClient<typeof rootOrpcContract>>

export const orpcQuery = createTanstackQueryUtils(orpcClient)

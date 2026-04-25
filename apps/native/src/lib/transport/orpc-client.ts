import type { ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import { createORPCClient } from '@orpc/client'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { getConfig } from '@/config/environment-config'
import { rootOrpcContract } from '@template-app/api-client/orpc-contracts/root-contract'

const apiPrefix = '/api/v1'
const hostWithPrefix = `${getConfig().apiHost}${apiPrefix}`

let getAuthHeaderValue = () => ''

export const setTokenGetter = (fn: () => string) => {
  getAuthHeaderValue = fn
}

const link = new OpenAPILink(rootOrpcContract, {
  url: hostWithPrefix,
  headers: () => {
    const authHeader = getAuthHeaderValue()
    if (authHeader) {
      return { Authorization: authHeader }
    }

    return {}
  },
})

export const orpcClient = createORPCClient(link) as JsonifiedClient<ContractRouterClient<typeof rootOrpcContract>>

export const orpcQuery = createTanstackQueryUtils(orpcClient)

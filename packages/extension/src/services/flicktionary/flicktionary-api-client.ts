import type { ContractRouterClient } from '@orpc/contract';
import type { JsonifiedClient } from '@orpc/openapi-client';
import { createORPCClient } from '@orpc/client';
import { OpenAPILink } from '@orpc/openapi-client/fetch';
import { rootOrpcContract } from '@flicktionary/api-client/orpc-contracts/root-contract';
import { getFlicktionaryConfig } from './flicktionary-config';
import { getCurrentAccessToken } from './flicktionary-supabase-client';

const buildLink = () =>
    new OpenAPILink(rootOrpcContract, {
        url: `${getFlicktionaryConfig().apiHost}/api/v1`,
        headers: async () => {
            const accessToken = await getCurrentAccessToken();
            if (!accessToken) return {};
            return { Authorization: `Bearer ${accessToken}` };
        },
    });

let cached: JsonifiedClient<ContractRouterClient<typeof rootOrpcContract>> | null = null;

export const getFlicktionaryApiClient = () => {
    if (!cached) {
        cached = createORPCClient(buildLink()) as JsonifiedClient<ContractRouterClient<typeof rootOrpcContract>>;
    }
    return cached;
};

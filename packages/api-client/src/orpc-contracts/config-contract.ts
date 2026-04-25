import { oc } from '@orpc/contract'
import { z } from 'zod'

export const CONFIG_PATH = '/config' as const

export const configContract = {
  getConfig: oc
    .route({
      method: 'GET',
      path: CONFIG_PATH,
      successStatus: 200,
    })
    .output(
      z.object({
        data: z.object({
          lowestSupportedVersionIos: z.string(),
          lowestSupportedVersionAndroid: z.string(),
        }),
      })
    ),
} as const

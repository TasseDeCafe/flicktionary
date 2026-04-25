import axios from 'axios'
import { FEATURES } from '@template-app/core/features'
import { getConfig } from '../../../config/environment-config'

export const client = FEATURES.REVENUECAT
  ? axios.create({
      baseURL: `https://api.revenuecat.com/v2/projects/${getConfig().revenuecatProjectId}`,
      headers: {
        Authorization: `Bearer ${getConfig().revenuecatApiKey}`,
        'Content-Type': 'application/json',
      },
    })
  : (null as unknown as ReturnType<typeof axios.create>)

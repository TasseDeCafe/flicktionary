// based on https://docs.doppler.com/docs/pm2
// We can't run doppler from the CLI in cluster mode.
import { execSync } from 'node:child_process'

const isRunningUnderDoppler = () => Boolean(process.env.DOPPLER_ENVIRONMENT || process.env.DOPPLER_PROJECT)

export const hydrateEnvFromDoppler = () => {
  if (process.env.NODE_ENV === 'test') return
  if (isRunningUnderDoppler()) return
  try {
    const output = execSync('doppler secrets download --no-file --format json', {
      stdio: 'pipe',
    }).toString()

    const secrets = JSON.parse(output) as Record<string, string>

    Object.entries(secrets).forEach(([key, value]) => {
      if (process.env[key]) return

      process.env[key] = value
    })
  } catch (error) {
    console.error('Failed to fetch Doppler secrets', error)
    process.exit(1)
  }
}

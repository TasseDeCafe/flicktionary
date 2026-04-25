import { hydrateEnvFromDoppler } from './bootstrap-doppler-secrets'

hydrateEnvFromDoppler()

await import('./server')

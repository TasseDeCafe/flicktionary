import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

type DopplerSecret = {
  computed: string
  computedValueType: { type: string }
  computedVisibility: string
  note: string
}

type DopplerSecrets = {
  [key: string]: DopplerSecret
}

type EasVariable = {
  name: string
  value: string
  environment: 'development' | 'preview' | 'production'
}

const ENV_FILE_PATH = path.join(__dirname, '.env.doppler')

const cleanupExistingMount = (): void => {
  try {
    // Try to remove any existing mount that might be left over
    execSync('doppler run clean', { stdio: 'pipe' })
  } catch {
    // Ignore errors here as the command might fail if there's no mount to clean
  }
}

const getDopplerSecrets = (): DopplerSecrets => {
  try {
    const output = execSync('doppler secrets --json --config prd', { encoding: 'utf-8' })
    return JSON.parse(output)
  } catch (error) {
    console.error('Failed to get Doppler secrets:', error)
    process.exit(1)
  }
}

const getEasVariables = (environment: string): EasVariable[] => {
  try {
    const output = execSync(`eas env:list ${environment} --format long`, { encoding: 'utf-8' })
    const variables: EasVariable[] = []

    // Split by the separator
    const entries = output.split('\n———\n')

    for (const entry of entries) {
      const lines = entry.split('\n').map((line) => line.trim())
      let name = ''
      let value = ''

      for (const line of lines) {
        if (line.startsWith('Name')) {
          name = line.replace('Name', '').trim()
        } else if (line.startsWith('Value')) {
          value = line.replace('Value', '').trim()
        }
      }

      if (name && value) {
        variables.push({ name, value, environment } as EasVariable)
      }
    }

    return variables
  } catch (error) {
    console.error('Failed to get EAS variables:', error)
    process.exit(1)
  }
}

const deleteEasVariable = (name: string, environment: string) => {
  try {
    execSync(`eas env:delete ${environment} --non-interactive --variable-name ${name}`, {
      stdio: 'pipe',
      encoding: 'utf-8',
    })
    console.log(`✅ Deleted variable ${name} from EAS`)
    return true
  } catch (error: any) {
    if (error.stdout?.includes('Variable') && error.stdout?.includes('not found')) {
      return false
    }
    console.error(`Failed to delete variable ${name} from EAS:`, error.stderr || error)
    return false
  }
}

const createEnvFile = (secrets: DopplerSecrets, keys?: string[]): void => {
  const filteredKeys = keys || Object.keys(secrets)
  const envContent = filteredKeys.map((key) => `${key}=${secrets[key].computed}`).join('\n')
  fs.writeFileSync(ENV_FILE_PATH, envContent, 'utf-8')
}

const cleanupEnvFile = (): void => {
  if (fs.existsSync(ENV_FILE_PATH)) {
    fs.unlinkSync(ENV_FILE_PATH)
  }
}

const syncEnvironmentVariables = (environment: string) => {
  console.log(`\n🚀 Starting environment variables sync from Doppler to EAS for ${environment} environment...`)

  // Clean up any existing Doppler mounts first
  console.log('🧹 Cleaning up any existing Doppler mounts...')
  cleanupExistingMount()

  const dopplerSecrets = getDopplerSecrets()
  // Filter out unmasked defaults from Doppler, like "DOPPLER_CONFIG"
  const filteredSecrets: DopplerSecrets = {}
  for (const key of Object.keys(dopplerSecrets)) {
    if (dopplerSecrets[key].computedVisibility !== 'unmasked') {
      filteredSecrets[key] = dopplerSecrets[key]
    }
  }
  const allKeys = Object.keys(filteredSecrets)

  // Separate public and secret variables
  const publicKeys = allKeys.filter((key) => key.startsWith('EXPO_PUBLIC_'))
  const secretKeys = allKeys.filter((key) => !key.startsWith('EXPO_PUBLIC_'))

  // Bulk push for public variables
  if (publicKeys.length > 0) {
    console.log('📝 Creating .env file for public variables...')
    createEnvFile(filteredSecrets, publicKeys)

    console.log('🚀 Pushing public variables to EAS...')
    execSync(`EAS_NON_INTERACTIVE=1 doppler run -- eas env:push ${environment} --path ${ENV_FILE_PATH}`, {
      stdio: 'inherit',
      env: { ...process.env, EAS_NON_INTERACTIVE: '1' },
    })

    cleanupEnvFile()
  } else {
    console.log('ℹ️ No public variables to push.')
  }

  // Get current EAS variables after bulk push
  let easVariables = getEasVariables(environment)
  const easVariableNames = new Set(easVariables.map((v) => v.name))

  // Individually update or create secret variables
  // This can't be done with a bulk push right now because EAS doesn't support bulk updates with a specific visibility
  for (const key of secretKeys) {
    const value = filteredSecrets[key].computed
    if (easVariableNames.has(key)) {
      console.log(`Updating secret variable ${key}...`)
      execSync(
        `EAS_NON_INTERACTIVE=1 doppler run -- eas env:update ${environment} --variable-environment ${environment} --variable-name ${key} --value "${value}" --visibility secret --non-interactive`,
        { stdio: 'inherit' }
      )
    } else {
      console.log(`Creating secret variable ${key}...`)
      execSync(
        `EAS_NON_INTERACTIVE=1 doppler run -- eas env:create ${environment} --name ${key} --value "${value}" --visibility secret --non-interactive`,
        { stdio: 'inherit' }
      )
    }
  }

  // Refresh EAS variables list and remove any variables not present in Doppler
  easVariables = getEasVariables(environment)
  const dopplerSecretNames = new Set(allKeys)
  console.log('🧹 Cleaning up removed variables...')
  for (const easVar of easVariables) {
    if (!dopplerSecretNames.has(easVar.name)) {
      deleteEasVariable(easVar.name, environment)
    }
  }
}

const main = () => {
  const environment = process.argv[2] || 'development'
  if (!['development', 'preview', 'production'].includes(environment)) {
    console.error('Invalid environment. Must be one of: development, preview, production')
    process.exit(1)
  }

  syncEnvironmentVariables(environment)
  console.log('\n✨ Sync completed!')
}

main()

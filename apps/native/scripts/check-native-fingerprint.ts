/**
 * This script checks if native app changes require a new build (version bump)
 * by comparing the current fingerprint against the stored .fingerprint file.
 *
 * It uses @expo/fingerprint which is the same tool EAS uses to determine
 * if an OTA update is sufficient or if a new native build is needed.
 *
 * Exit codes:
 *   0 - No native build required (fingerprints match)
 *   1 - Native build required (fingerprints differ)
 *   2 - Error occurred
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as Fingerprint from 'expo/fingerprint'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const NATIVE_DIR = path.resolve(__dirname, '..')
const FINGERPRINT_FILE = path.join(NATIVE_DIR, '.fingerprint')

async function main() {
  const command = process.argv[2]

  if (command === 'update') {
    // Update the stored fingerprint
    console.log('🔄 Updating stored fingerprint...')
    const fingerprint = await Fingerprint.createFingerprintAsync(NATIVE_DIR)
    fs.writeFileSync(FINGERPRINT_FILE, fingerprint.hash + '\n')
    console.log(`✅ Fingerprint updated: ${fingerprint.hash}`)
    process.exit(0)
  }

  if (command === 'check' || !command) {
    // Check current fingerprint against stored
    console.log('🔍 Checking native app fingerprint...')

    // Read stored fingerprint
    let storedHash: string | null = null
    if (fs.existsSync(FINGERPRINT_FILE)) {
      storedHash = fs.readFileSync(FINGERPRINT_FILE, 'utf-8').trim()
    }

    if (!storedHash) {
      console.log('⚠️  No stored fingerprint found. Run with "update" to create one.')
      console.log('   Assuming native build is required.')
      process.exit(1)
    }

    // Generate current fingerprint
    const currentFingerprint = await Fingerprint.createFingerprintAsync(NATIVE_DIR)

    console.log(`   Stored fingerprint:  ${storedHash}`)
    console.log(`   Current fingerprint: ${currentFingerprint.hash}`)

    if (currentFingerprint.hash === storedHash) {
      console.log('✅ Fingerprints match - OTA update only (no new build required)')
      process.exit(0)
    } else {
      console.log('\n⚠️  Fingerprints differ - new native build required')
      process.exit(1)
    }
  }

  console.log('Usage: check-native-fingerprint.ts [check|update]')
  process.exit(2)
}

main().catch((error) => {
  console.error('❌ Error:', error)
  process.exit(2)
})

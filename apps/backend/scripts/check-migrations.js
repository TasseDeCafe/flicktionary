import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const MIGRATION_DIRS = [
  'supabase/supabase-dev/supabase/migrations',
  'supabase/supabase-test/supabase/migrations',
  'supabase/supabase-prod/supabase/migrations',
  'supabase/supabase-dev-tunnel/supabase/migrations',
]

function getMigrationFiles(dir) {
  return fs.readdirSync(dir).filter((file) => file.endsWith('.sql'))
}

function compareFileContents(file1Path, file2Path) {
  const content1 = fs.readFileSync(file1Path, 'utf8')
  const content2 = fs.readFileSync(file2Path, 'utf8')
  return content1 === content2
}

function checkMigrations() {
  const basePath = path.join(__dirname, '..')
  const allMigrationFiles = MIGRATION_DIRS.map((dir) => ({
    dir,
    files: getMigrationFiles(path.join(basePath, dir)),
  }))

  // Check if all directories have the same files
  const baseFiles = new Set(allMigrationFiles[0].files)
  const missingFiles = []

  allMigrationFiles.slice(1).forEach(({ dir, files }) => {
    const currentFiles = new Set(files)

    // Check for files in base but not in current
    baseFiles.forEach((file) => {
      if (!currentFiles.has(file)) {
        missingFiles.push(`${file} is missing in ${dir}`)
      }
    })

    // Check for files in current but not in base
    currentFiles.forEach((file) => {
      if (!baseFiles.has(file)) {
        missingFiles.push(`${file} is extra in ${dir}`)
      }
    })
  })

  if (missingFiles.length > 0) {
    console.error('❌ Migration files mismatch:')
    missingFiles.forEach((msg) => console.error(msg))
    process.exit(1)
  }

  // Compare contents of files
  const differentContents = []
  const baseDir = path.join(basePath, MIGRATION_DIRS[0])

  allMigrationFiles.slice(1).forEach(({ dir, files }) => {
    const currentDir = path.join(basePath, dir)
    files.forEach((file) => {
      if (!compareFileContents(path.join(baseDir, file), path.join(currentDir, file))) {
        differentContents.push(`${file} has different content in ${dir} compared to ${MIGRATION_DIRS[0]}`)
      }
    })
  })

  if (differentContents.length > 0) {
    console.error('❌ Migration content differences:')
    differentContents.forEach((msg) => console.error(msg))
    process.exit(1)
  }

  console.log('✅ All migration files are consistent across environments')
  process.exit(0)
}

checkMigrations()

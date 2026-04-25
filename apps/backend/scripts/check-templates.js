import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const environments = ['dev', 'test', 'prod', 'dev-tunnel']

const getTemplateFiles = (env) => {
  const templateDir = path.join(__dirname, `../supabase/supabase-${env}/supabase/templates`)
  return fs.readdirSync(templateDir).filter((file) => file.endsWith('.html'))
}

const getFileHash = (filePath) => {
  const fileBuffer = fs.readFileSync(filePath)
  const hashSum = crypto.createHash('sha256')
  hashSum.update(fileBuffer)
  return hashSum.digest('hex')
}

const compareArrays = (arr1, arr2) => {
  return arr1.length === arr2.length && arr1.every((val, index) => val === arr2[index])
}

const checkTemplates = () => {
  const templateFiles = environments.map((env) => getTemplateFiles(env))

  // Check for file name differences
  const allFilesEqual = templateFiles.every((files, index) => {
    const isEqual = compareArrays(files, templateFiles[0])
    if (!isEqual) {
      console.error(`\nFile list mismatch in ${environments[index]} environment:`)
      console.error(`Expected files: ${templateFiles[0].join(', ')}`)
      console.error(`Found files: ${files.join(', ')}`)

      // Show which files are missing or extra
      const missing = templateFiles[0].filter((file) => !files.includes(file))
      const extra = files.filter((file) => !templateFiles[0].includes(file))

      if (missing.length > 0) {
        console.error(`Missing files in ${environments[index]}: ${missing.join(', ')}`)
      }
      if (extra.length > 0) {
        console.error(`Extra files in ${environments[index]}: ${extra.join(', ')}`)
      }
    }
    return isEqual
  })

  if (!allFilesEqual) {
    console.error('\n❌ Template files are not in sync across environments!')
    process.exit(1)
  }

  console.log('\n✅ Template file names are in sync across all environments.')

  const baseEnv = environments[0]
  const baseDir = path.join(__dirname, `../supabase/supabase-${baseEnv}/supabase/templates`)

  let allContentsEqual = true

  templateFiles[0].forEach((file) => {
    const baseFileHash = getFileHash(path.join(baseDir, file))
    const baseFilePath = path.join(baseDir, file)

    for (let i = 1; i < environments.length; i++) {
      const envDir = path.join(__dirname, `../supabase/supabase-${environments[i]}/supabase/templates`)
      const envFilePath = path.join(envDir, file)
      const envFileHash = getFileHash(envFilePath)

      if (baseFileHash !== envFileHash) {
        console.error(`\nFile content mismatch for: ${file}`)
        console.error(`Between:`)
        console.error(`  - ${baseFilePath}`)
        console.error(`  - ${envFilePath}`)
        allContentsEqual = false
      }
    }
  })

  if (allContentsEqual) {
    console.log('\n✅ All template file contents are identical across environments.')
  } else {
    console.error('\n❌ Some template file contents differ across environments!')
    process.exit(1)
  }
}

checkTemplates()

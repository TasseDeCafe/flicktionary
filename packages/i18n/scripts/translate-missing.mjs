#!/usr/bin/env node
/**
 * Translate missing translations in Lingui catalog files using Claude AI
 *
 * This script:
 * 1. Reads lingui.config.mjs to find all .po catalog files
 * 2. Parses each .po file to find missing translations
 * 3. Uses Claude API to translate missing entries
 * 4. Writes translations back to the .po files
 */

import { createAnthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import gettextParser from 'gettext-parser'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '../../..')

// Configuration
const CLAUDE_MODEL = 'claude-sonnet-4-5'
const SYSTEM_PROMPT = `You are a professional translator with expertise in software localization.

Guidelines:
- Preserve all placeholders (e.g., {0}, {1}, {variable})
- Preserve all markup tags (e.g., <0>, </0>, <1>, </1>)
- Maintain the same level of formality as the source text
- Consider the context of UI/UX terminology
- Keep translations concise and natural
- Do not add extra punctuation unless grammatically required in the target language
- Match the tone and style of the original text

Respond with ONLY the translated text. No additional formatting, explanations, or characters should be included unless they are part of the actual translation.`

/**
 * Get catalog file paths from lingui.config.mjs
 */
async function getCatalogFiles() {
  const configPath = path.join(projectRoot, 'lingui.config.mjs')
  const { default: config } = await import(configPath)
  const catalogExtension = config.format?.catalogExtension ?? '.po'

  const catalogFiles = []
  for (const locale of config.locales) {
    if (locale === config.sourceLocale) continue // Skip source locale

    for (const catalog of config.catalogs) {
      const catalogPath = catalog.path.replace('<rootDir>', projectRoot).replace('{locale}', locale)
      catalogFiles.push(`${catalogPath}${catalogExtension}`)
    }
  }

  return catalogFiles
}

/**
 * Parse a .po file and find missing translations
 */
async function getMissingTranslations(catalogFile) {
  const poContent = await fs.readFile(catalogFile, 'utf-8')
  const po = gettextParser.po.parse(poContent)
  const locale = po.headers['Language']
  const missingTranslations = []

  for (const [key, translation] of Object.entries(po.translations[''])) {
    if (key === '') continue // Skip metadata entry

    const isMissing =
      !translation.msgstr || translation.msgstr.length === 0 || translation.msgstr.some((msgstr) => msgstr === '')

    if (isMissing) {
      const reference = translation.comments?.reference ?? ''
      const [filePath, line] = reference.split(':')

      missingTranslations.push({
        catalogFile,
        key,
        locale,
        reference: {
          filePath: filePath ? path.resolve(projectRoot, filePath) : '',
          line: line ? Number(line) : 0,
        },
      })
    }
  }

  return missingTranslations
}

/**
 * Translate a single missing translation using Claude
 */
async function translateOne(anthropic, missingTranslation) {
  const model = anthropic(CLAUDE_MODEL)

  // Read the source file for context (if available)
  let fileContents = ''
  try {
    if (missingTranslation.reference.filePath) {
      fileContents = await fs.readFile(missingTranslation.reference.filePath, 'utf-8')
    }
  } catch (error) {
    // File might not exist or be readable, continue without context
    console.warn(`Warning: Could not read source file ${missingTranslation.reference.filePath}`)
  }

  const prompt = `I need you to translate a text for me. The text appears in an application and I need you to give me the translation to the ${missingTranslation.locale} language locale.
The translation includes some special characters like placeholders (e.g. {0} or {1}) or markup (e.g. <1> or </1>) that need to be preserved. DO NOT include extra spaces, end of line characters or punctuation.
${fileContents ? `I'm including here the file where the translation appears to give you additional context:\n\n\`\`\`\n${fileContents}\n\`\`\`\n\n` : ''}Finally, translate the following text: "${missingTranslation.key}"`

  const { object } = await generateObject({
    model,
    prompt,
    system: SYSTEM_PROMPT,
    schema: z.object({ translation: z.string() }),
  })

  return {
    ...missingTranslation,
    translation: object.translation.trim(),
  }
}

/**
 * Add translations to .po files
 */
async function addTranslations(filledTranslations) {
  // Group translations by catalog file
  const translationsByCatalog = {}
  for (const translation of filledTranslations) {
    if (!translationsByCatalog[translation.catalogFile]) {
      translationsByCatalog[translation.catalogFile] = []
    }
    translationsByCatalog[translation.catalogFile].push(translation)
  }

  // Update each catalog file
  for (const [catalogFile, translations] of Object.entries(translationsByCatalog)) {
    const poContent = await fs.readFile(catalogFile, 'utf-8')
    const po = gettextParser.po.parse(poContent)

    for (const translation of translations) {
      po.translations[''][translation.key]['msgstr'] = [translation.translation]
    }

    const buffer = gettextParser.po.compile(po, { foldLength: 0 })
    await fs.writeFile(catalogFile, buffer)
    console.log(`✅ Updated ${catalogFile}`)
  }
}

/**
 * Main function
 */
async function main() {
  // Check for API key
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('❌ Error: ANTHROPIC_API_KEY environment variable is not set')
    process.exit(1)
  }

  console.log('🔍 Finding catalog files...')
  const catalogFiles = await getCatalogFiles()
  console.log(`Found ${catalogFiles.length} catalog files`)

  console.log('🔍 Searching for missing translations...')
  const allMissingTranslations = []
  for (const catalogFile of catalogFiles) {
    const missing = await getMissingTranslations(catalogFile)
    allMissingTranslations.push(...missing)
  }

  if (allMissingTranslations.length === 0) {
    console.log('✅ No missing translations found!')
    process.exit(0)
  }

  console.log(`Found ${allMissingTranslations.length} missing translations`)
  console.log('🤖 Translating with Claude...')

  // Create Anthropic client
  const anthropic = createAnthropic({ apiKey })

  // Translate each missing translation
  const filledTranslations = []
  for (let i = 0; i < allMissingTranslations.length; i++) {
    const missing = allMissingTranslations[i]
    console.log(`Translating "${missing.key}" -> ${missing.locale}`)

    const filled = await translateOne(anthropic, missing)

    console.log(`Translation of "${missing.key}" -> ${missing.locale} completed`)
    filledTranslations.push(filled)
  }

  console.log('💾 Writing translations to files...')
  await addTranslations(filledTranslations)

  console.log(`✅ Successfully translated ${filledTranslations.length} entries!`)
}

main().catch((error) => {
  console.error('❌ Error:', error.message)
  process.exit(1)
})

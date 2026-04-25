#!/usr/bin/env node
/**
 * Detect raw English strings that need Lingui wrapping
 *
 * This script scans .tsx and .ts files to find user-facing strings that should be translated.
 * It detects:
 * - JSX text content
 * - User-facing props (placeholder, title, aria-label, etc.)
 * - Toast messages
 * - Dialog/Modal/Drawer content
 * - Meta field strings in react-query hooks (errorMessage, successMessage)
 *
 * Usage:
 *   node detect-raw-strings.mjs [target-directory]
 *
 * If no directory is specified, defaults to apps/native/src
 * For web app: node detect-raw-strings.mjs apps/web/src
 * For landing page: node detect-raw-strings.mjs apps/landing-page/src
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '../../..')

// Get target directory from command line args or default to native app
const targetDir = process.argv[2] || 'apps/native/src'
const scanDirectory = path.join(projectRoot, targetDir)

// Props that typically contain user-facing text
const USER_FACING_PROPS = [
  'placeholder',
  'title',
  'aria-label',
  'ariaLabel',
  'alt',
  'label',
  'description',
  'content',
  'message',
  'text',
  'helperText',
  'errorText',
]

const ADDITIONAL_TEXT_FIELDS = ['heading', 'subtitle', 'buttonText', 'cta', 'ctaText', 'emptyStateTitle', 'emptyStateDescription']

const TEXTUAL_PROPERTY_BASE_NAMES = new Set(
  [...USER_FACING_PROPS, ...ADDITIONAL_TEXT_FIELDS].map((prop) => prop.replace(/[^a-z]/gi, '').toLowerCase())
)

const CAMEL_CASE_TEXTUAL_SUFFIXES = ['Title', 'Description', 'Label', 'Message', 'Text', 'Heading', 'Subtitle', 'Cta']
const SNAKE_CASE_TEXTUAL_SUFFIXES = CAMEL_CASE_TEXTUAL_SUFFIXES.flatMap((suffix) => [
  `_${suffix.toLowerCase()}`,
  `-${suffix.toLowerCase()}`,
])

const STYLE_HELPER_NAMES = new Set(['cn', 'clsx', 'classNames', 'cva', 'twMerge'])

// Strings that should NOT be translated
const EXCLUDE_PATTERNS = [
  /^[\s\n]*$/, // Empty or whitespace only
  /^[0-9\s\-\+\(\)]+$/, // Only numbers and basic punctuation
  /^https?:\/\//, // URLs
  /^\/[a-z0-9\-\/]*$/i, // Route paths like /dashboard
  /^#[0-9a-f]{3,8}$/i, // Color codes
  /^[a-z_\-]+$/i, // Single lowercase words (likely identifiers)
  /^[A-Z_]+$/, // All caps (likely constants)
  /discord/i, // Service names
  /template-app\.com/i,
  /supabase/i,
  /github/i,
  /google/i,
  /^(close|ok|yes|no)$/i, // Common single words
  /^web$/i, // Technical terms
  /^\d+(\.\d+)?x$/, // Speed multipliers like "1.5x"
  /^xp$/i, // Gaming term
]

/**
 * Recursively find all .tsx and .ts files in a directory
 */
async function findTsxFiles(dir) {
  const files = []
  const entries = await fs.readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      // Skip node_modules, __tests__, .next, etc.
      if (
        entry.name === 'node_modules' ||
        entry.name === '__tests__' ||
        entry.name === '.next' ||
        entry.name === 'dist' ||
        entry.name.includes('.test.')
      ) {
        continue
      }
      files.push(...(await findTsxFiles(fullPath)))
    } else if ((entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) && !entry.name.includes('.test.')) {
      files.push(fullPath)
    }
  }

  return files
}

/**
 * Check if a string should be excluded from translation
 */
function shouldExclude(str) {
  if (!str || typeof str !== 'string') return true

  const trimmed = str.trim()
  if (trimmed.length === 0) return true
  if (trimmed.length <= 2) return true // Too short

  // Check against exclusion patterns
  for (const pattern of EXCLUDE_PATTERNS) {
    if (pattern.test(trimmed)) return true
  }

  // Exclude if it's just a variable name or camelCase
  if (/^[a-z][a-zA-Z0-9]*$/.test(trimmed) && trimmed.length < 15) return true

  return false
}

const createLineHelper = (content) => {
  const lines = content.split('\n')
  const lineStartIndices = [0]

  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') {
      lineStartIndices.push(i + 1)
    }
  }

  return {
    lines,
    lineStartIndices,
  }
}

const getLineNumberFromIndex = (lineHelper, index) => {
  const { lineStartIndices } = lineHelper
  let low = 0
  let high = lineStartIndices.length - 1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const start = lineStartIndices[mid]
    const nextStart = mid + 1 < lineStartIndices.length ? lineStartIndices[mid + 1] : Infinity

    if (index >= start && index < nextStart) {
      return mid + 1
    }

    if (index < start) {
      high = mid - 1
    } else {
      low = mid + 1
    }
  }

  return lineStartIndices.length
}

const normalizePropertyName = (nameNode) => {
  if (!nameNode) return ''

  if (ts.isIdentifier(nameNode) || ts.isPrivateIdentifier?.(nameNode)) {
    return nameNode.text
  }

  if (ts.isStringLiteral(nameNode) || ts.isNumericLiteral(nameNode)) {
    return String(nameNode.text)
  }

  return nameNode.getText().replace(/['"`]/g, '')
}

const isLikelyTextualPropertyName = (nameNode) => {
  const rawName = normalizePropertyName(nameNode)
  if (!rawName) return false

  const alphaOnlyName = rawName.replace(/[^a-z]/gi, '').toLowerCase()
  if (TEXTUAL_PROPERTY_BASE_NAMES.has(alphaOnlyName)) {
    return true
  }

  if (/[A-Z]/.test(rawName) && CAMEL_CASE_TEXTUAL_SUFFIXES.some((suffix) => rawName.endsWith(suffix))) {
    return true
  }

  const lowerRaw = rawName.toLowerCase()
  if (SNAKE_CASE_TEXTUAL_SUFFIXES.some((suffix) => lowerRaw.endsWith(suffix))) {
    return true
  }

  return false
}

const isStringLiteralLike = (node) =>
  ts.isStringLiteral(node) || node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral

const isTranslationCallee = (expression) => {
  if (ts.isIdentifier(expression)) {
    return expression.text === 't' || expression.text === 'msg'
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text === '_' && expression.expression.getText().trim() === 'i18n'
  }

  return false
}

const isWithinStyleHelper = (node) => {
  let current = node.parent

  while (current) {
    if (ts.isCallExpression(current)) {
      const callee = current.expression
      if (ts.isIdentifier(callee) && STYLE_HELPER_NAMES.has(callee.text)) {
        return true
      }
    }
    current = current.parent
  }

  return false
}

/**
 * Check if a line already uses Lingui (has t\`\`, <Trans>, Trans>, or msg)
 */
function isAlreadyWrapped(line) {
  return /t\`|<Trans|Trans>|msg\`|i18n\._/.test(line)
}

/**
 * Find raw strings in JSX text content
 * Pattern: >Some text here< (but not >{variable}< or >{t\`text\`}<)
 */
function findJsxTextContent(filePath, content, lineHelper) {
  const findings = []
  const jsxTextPattern = /<([A-Za-z][^>\s]*)[^>]*>([^<{]+)<\/\1>/g

  for (const match of content.matchAll(jsxTextPattern)) {
    const rawText = match[2]
    const normalizedText = rawText.replace(/\s+/g, ' ').trim()

    if (!/[a-zA-Z]/.test(normalizedText) || shouldExclude(normalizedText)) {
      continue
    }

    const textStartIndex = match.index + match[0].indexOf(rawText)
    const lineNum = getLineNumberFromIndex(lineHelper, textStartIndex)
    const rawLine = lineHelper.lines[lineNum - 1] ?? ''
    const trimmedLine = rawLine.trim()

    if (isAlreadyWrapped(rawLine) || trimmedLine.startsWith('//') || trimmedLine.startsWith('*')) {
      continue
    }

    findings.push({
      file: path.relative(projectRoot, filePath),
      line: lineNum,
      type: 'jsx-text',
      text: normalizedText,
      context: trimmedLine || normalizedText,
    })
  }

  return findings
}

/**
 * Find raw strings in props
 * Pattern: propName="value" or propName='value' or propName={\`value\`}
 */
function findPropsWithStrings(filePath, content, lineHelper) {
  const findings = []

  const recordFinding = (prop, match, rawText) => {
    const normalized = rawText.trim()

    if (!/[a-zA-Z]/.test(normalized) || shouldExclude(normalized)) {
      return
    }

    const textStartIndex = match.index + match[0].indexOf(rawText)
    const lineNum = getLineNumberFromIndex(lineHelper, textStartIndex)
    const rawLine = lineHelper.lines[lineNum - 1] ?? ''
    const trimmedLine = rawLine.trim()

    if (isAlreadyWrapped(rawLine)) {
      return
    }

    findings.push({
      file: path.relative(projectRoot, filePath),
      line: lineNum,
      type: `prop-${prop}`,
      text: normalized,
      context: trimmedLine || normalized,
    })
  }

  for (const prop of USER_FACING_PROPS) {
    const doubleQuotePattern = new RegExp(`${prop}\\s*=\\s*"([^"]+)"`, 'g')
    const singleQuotePattern = new RegExp(`${prop}\\s*=\\s*'([^']+)'`, 'g')
    const templatePattern = new RegExp(`${prop}\\s*=\\s*\{?\\s*\`([\\s\\S]+?)\`\\s*\}?`, 'g')

    for (const match of content.matchAll(doubleQuotePattern)) {
      recordFinding(prop, match, match[1])
    }

    for (const match of content.matchAll(singleQuotePattern)) {
      recordFinding(prop, match, match[1])
    }

    for (const match of content.matchAll(templatePattern)) {
      const text = match[1]
      if (text.includes('${')) {
        continue
      }
      recordFinding(prop, match, text)
    }
  }

  return findings
}

/**
 * Find toast messages
 * Pattern: toast.success('message'), toast.error('message'), etc.
 */
function findToastMessages(filePath, content) {
  const findings = []
  const lines = content.split('\n')

  const toastPattern = /toast\.(success|error|info|warning)\s*\(\s*['"`]([^'"`]+)['"`]/g

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    // Skip if already wrapped
    if (isAlreadyWrapped(line)) {
      continue
    }

    let match
    while ((match = toastPattern.exec(line)) !== null) {
      const text = match[2]
      if (/[a-zA-Z]/.test(text) && !shouldExclude(text)) {
        findings.push({
          file: path.relative(projectRoot, filePath),
          line: lineNum,
          type: `toast-${match[1]}`,
          text: text,
          context: line.trim(),
        })
      }
    }
  }

  return findings
}

/**
 * Find Dialog/Modal/Drawer titles and descriptions
 * Pattern: <DialogTitle>Text</DialogTitle>, etc.
 */
function findDialogContent(filePath, content) {
  const findings = []
  const lines = content.split('\n')

  const components = [
    'DialogTitle',
    'DialogDescription',
    'DrawerTitle',
    'DrawerDescription',
    'ModalTitle',
    'SheetTitle',
    'SheetDescription',
    'AlertTitle',
    'AlertDescription',
    'CardTitle',
    'CardDescription',
  ]

  for (const component of components) {
    const pattern = new RegExp(`<${component}[^>]*>([^<]+)</${component}>`, 'g')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineNum = i + 1

      // Skip if already wrapped
      if (isAlreadyWrapped(line)) {
        continue
      }

      let match
      while ((match = pattern.exec(line)) !== null) {
        const text = match[1].trim()
        if (/[a-zA-Z]/.test(text) && !shouldExclude(text)) {
          findings.push({
            file: path.relative(projectRoot, filePath),
            line: lineNum,
            type: `component-${component}`,
            text: text,
            context: line.trim(),
          })
        }
      }
    }
  }

  return findings
}

/**
 * Find strings in meta fields (react-query hooks)
 * Pattern: errorMessage: 'text', successMessage: 'text'
 */
function findMetaFieldStrings(filePath, content) {
  const findings = []
  const lines = content.split('\n')

  // Pattern to match meta field strings
  const metaFieldPattern = /(errorMessage|successMessage):\s*['"`]([^'"`]+)['"`]/g

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    // Skip if already wrapped with t``
    if (isAlreadyWrapped(line)) {
      continue
    }

    let match
    while ((match = metaFieldPattern.exec(line)) !== null) {
      const fieldName = match[1]
      const text = match[2]

      if (/[a-zA-Z]/.test(text) && !shouldExclude(text)) {
        findings.push({
          file: path.relative(projectRoot, filePath),
          line: lineNum,
          type: `meta-${fieldName}`,
          text: text,
          context: line.trim(),
        })
      }
    }
  }

  return findings
}

const shouldSkipStringLiteralNode = (node) => {
  const parent = node.parent
  if (!parent) return false

  if (isWithinStyleHelper(node)) {
    return true
  }

  if (
    ts.isImportDeclaration(parent) ||
    ts.isExportDeclaration(parent) ||
    ts.isImportEqualsDeclaration(parent) ||
    ts.isExternalModuleReference?.(parent) ||
    ts.isExportAssignment?.(parent)
  ) {
    return true
  }

  if (ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return true
  }

  if (ts.isJsxAttribute(parent)) {
    return true
  }

  if (ts.isLiteralTypeNode(parent) || ts.isEnumMember(parent)) {
    return true
  }

  if (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration?.(parent) || ts.isPropertySignature?.(parent)) {
    return !isLikelyTextualPropertyName(parent.name)
  }

  if (ts.isTaggedTemplateExpression(parent)) {
    return true
  }

  if (ts.isCallExpression(parent) && isTranslationCallee(parent.expression)) {
    return true
  }

  return false
}

function findStandaloneStringLiterals(filePath, content, lineHelper) {
  const findings = []
  const scriptKind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKind)

  const visit = (node) => {
    if (isStringLiteralLike(node)) {
      const text = node.text.trim()

      if (text && /[a-zA-Z]/.test(text) && !shouldExclude(text) && !shouldSkipStringLiteralNode(node)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart())
        const lineNum = line + 1
        const rawLine = lineHelper.lines[lineNum - 1] ?? ''
        const trimmedLine = rawLine.trim()

        findings.push({
          file: path.relative(projectRoot, filePath),
          line: lineNum,
          type: 'string-literal',
          text,
          context: trimmedLine || text,
        })
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return findings
}

/**
 * Analyze a single file for raw strings
 */
async function analyzeFile(filePath) {
  const content = await fs.readFile(filePath, 'utf-8')
  const lineHelper = createLineHelper(content)

  const findings = [
    ...findJsxTextContent(filePath, content, lineHelper),
    ...findPropsWithStrings(filePath, content, lineHelper),
    ...findToastMessages(filePath, content),
    ...findDialogContent(filePath, content),
    ...findMetaFieldStrings(filePath, content),
    ...findStandaloneStringLiterals(filePath, content, lineHelper),
  ]

  return findings
}

/**
 * Generate a markdown report
 */
function generateReport(allFindings) {
  const byType = {}
  const byFile = {}

  // Group findings
  for (const finding of allFindings) {
    // By type
    if (!byType[finding.type]) {
      byType[finding.type] = []
    }
    byType[finding.type].push(finding)

    // By file
    if (!byFile[finding.file]) {
      byFile[finding.file] = []
    }
    byFile[finding.file].push(finding)
  }

  // Generate report
  let report = '# Raw English Strings Detection Report\n\n'
  report += `**Generated:** ${new Date().toISOString()}\n`
  report += `**Scanned directory:** ${targetDir}\n`
  report += `**Total findings:** ${allFindings.length}\n\n`

  // Summary by type
  report += '## Summary by Type\n\n'
  const sortedTypes = Object.entries(byType).sort((a, b) => b[1].length - a[1].length)
  for (const [type, findings] of sortedTypes) {
    report += `- **${type}**: ${findings.length} occurrences\n`
  }
  report += '\n'

  // Summary by file
  report += '## Summary by File\n\n'
  const sortedFiles = Object.entries(byFile).sort((a, b) => b[1].length - a[1].length)
  report += `**Files with findings:** ${sortedFiles.length}\n\n`

  for (const [file, findings] of sortedFiles.slice(0, 20)) {
    report += `- **${file}**: ${findings.length} findings\n`
  }

  if (sortedFiles.length > 20) {
    report += `\n... and ${sortedFiles.length - 20} more files\n`
  }
  report += '\n'

  // Detailed findings by type
  report += '## Detailed Findings\n\n'

  for (const [type, findings] of sortedTypes) {
    report += `### ${type} (${findings.length} findings)\n\n`

    // Show first 50 of each type
    const showCount = Math.min(50, findings.length)
    for (let i = 0; i < showCount; i++) {
      const finding = findings[i]
      report += `**${finding.file}:${finding.line}**\n`
      report += `- Text: \`${finding.text}\`\n`
      report += `- Context: \`${finding.context}\`\n\n`
    }

    if (findings.length > 50) {
      report += `... and ${findings.length - 50} more\n\n`
    }
  }

  return report
}

/**
 * Generate a JSON report for programmatic processing
 */
function generateJsonReport(allFindings) {
  return JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      scannedDirectory: targetDir,
      totalFindings: allFindings.length,
      findings: allFindings,
    },
    null,
    2
  )
}

/**
 * Main function
 */
async function main() {
  console.log('🔍 Scanning for raw English strings...')
  console.log(`📁 Source directory: ${scanDirectory}\n`)

  // Check if directory exists
  try {
    await fs.access(scanDirectory)
  } catch (error) {
    console.error(`❌ Error: Directory not found: ${scanDirectory}`)
    console.error('Usage: node detect-raw-strings.mjs [target-directory]')
    console.error('Examples:')
    console.error('  node detect-raw-strings.mjs apps/native/src')
    console.error('  node detect-raw-strings.mjs apps/web/src')
    console.error('  node detect-raw-strings.mjs apps/landing-page/src')
    process.exit(1)
  }

  // Find all .tsx and .ts files
  const tsxFiles = await findTsxFiles(scanDirectory)
  console.log(`Found ${tsxFiles.length} .tsx/.ts files\n`)

  // Analyze each file
  console.log('🔎 Analyzing files...')
  const allFindings = []

  for (let i = 0; i < tsxFiles.length; i++) {
    const file = tsxFiles[i]

    if (i % 10 === 0) {
      console.log(`  Progress: ${i}/${tsxFiles.length} files analyzed...`)
    }

    const findings = await analyzeFile(file)
    allFindings.push(...findings)
  }

  console.log(`  Progress: ${tsxFiles.length}/${tsxFiles.length} files analyzed...\n`)
  console.log(`✅ Analysis complete! Found ${allFindings.length} raw strings\n`)

  // Generate reports
  console.log('📝 Generating reports...')

  const mdReport = generateReport(allFindings)
  const jsonReport = generateJsonReport(allFindings)

  const reportDir = path.join(__dirname, '../reports')
  await fs.mkdir(reportDir, { recursive: true })

  const mdPath = path.join(reportDir, 'raw-strings-report.md')
  const jsonPath = path.join(reportDir, 'raw-strings-report.json')

  await fs.writeFile(mdPath, mdReport)
  await fs.writeFile(jsonPath, jsonReport)

  console.log(`✅ Markdown report: ${path.relative(projectRoot, mdPath)}`)
  console.log(`✅ JSON report: ${path.relative(projectRoot, jsonPath)}`)
  console.log(`\n📊 Summary:`)
  console.log(`   Total raw strings found: ${allFindings.length}`)
  console.log(`   Files with findings: ${new Set(allFindings.map((f) => f.file)).size}`)
}

main().catch((error) => {
  console.error('❌ Error:', error.message)
  console.error(error.stack)
  process.exit(1)
})

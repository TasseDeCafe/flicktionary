import { render } from '@react-email/components'
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// All Supabase instances that need the email templates
const SUPABASE_INSTANCES = ['supabase-dev', 'supabase-dev-tunnel', 'supabase-test', 'supabase-prod']

async function buildEmailTemplates() {
  console.log('Building email templates...\n')

  // Import the email component
  const { default: MagicLinkEmail } = await import('../emails/magic-link.js')

  // Render to HTML
  const html = await render(MagicLinkEmail({}), {
    pretty: true,
  })

  // Write to all Supabase instances
  for (const instance of SUPABASE_INSTANCES) {
    const outputPath = join(
      __dirname,
      '..',
      'supabase',
      instance,
      'supabase',
      'templates',
      'magic-link-verification.html'
    )

    // Ensure directory exists
    const outputDir = dirname(outputPath)
    mkdirSync(outputDir, { recursive: true })

    // Write the file
    writeFileSync(outputPath, html)

    console.log(`✓ Generated magic-link-verification.html for ${instance}`)
  }

  console.log('\n✓ All email templates generated successfully!')
}

buildEmailTemplates().catch((error) => {
  console.error('Error building email templates:', error)
  process.exit(1)
})

import { renderSettingsUi } from '@/ui/settings'
import { ensureNotoSansFonts } from '@/ui/fonts/ensure-noto-sans'
import '@/ui/pages.css'

ensureNotoSansFonts()

window.addEventListener('load', () => {
  const root = document.getElementById('root')!
  renderSettingsUi(root)
})

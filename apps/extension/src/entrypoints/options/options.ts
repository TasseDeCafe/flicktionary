import { renderSettingsUi } from '@/ui/settings'
import '@/ui/pages.css'

window.addEventListener('load', () => {
  const root = document.getElementById('root')!
  renderSettingsUi(root)
})

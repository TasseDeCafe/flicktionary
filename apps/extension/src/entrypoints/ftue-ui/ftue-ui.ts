import { renderFtueUi } from '@/ui/ftue'
import { ensureNotoSansFonts } from '@/ui/fonts/ensure-noto-sans'
import '@/ui/pages.css'

ensureNotoSansFonts()

window.addEventListener('load', () => {
  const root = document.getElementById('root')!
  renderFtueUi(root)
})

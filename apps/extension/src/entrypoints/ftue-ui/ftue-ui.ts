import { renderFtueUi } from '@/ui/ftue'
import '@/ui/pages.css'

window.addEventListener('load', () => {
  const root = document.getElementById('root')!
  renderFtueUi(root)
})

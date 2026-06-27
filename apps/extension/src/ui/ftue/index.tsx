import { createRoot } from 'react-dom/client'
import FtueUi from '../components/ftue-ui'

export function renderFtueUi(element: Element) {
  createRoot(element).render(<FtueUi />)
}

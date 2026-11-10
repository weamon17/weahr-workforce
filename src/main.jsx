import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Root from './Root.jsx'
import { registerPwa } from './pwa'
import { readKioskCredential } from './utils/kiosk'

import './i18n'

registerPwa()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root kioskCredential={readKioskCredential()} />
  </StrictMode>,
)

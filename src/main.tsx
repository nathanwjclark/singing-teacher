import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

// The phone capture page and the studio share one build; each page loads only its own code.
const { default: Page } = await (window.location.pathname === '/phone' ? import('./components/phone/PhoneCapturePage') : import('./App.tsx'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
)

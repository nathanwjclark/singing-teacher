import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const root = document.getElementById('root')!
// The phone capture page and the studio share one build; each page loads only its own code.
try {
  const { default: Page } = await (window.location.pathname === '/phone' ? import('./components/phone/PhoneCapturePage') : import('./App.tsx'))
  createRoot(root).render(
    <StrictMode>
      <Page />
    </StrictMode>,
  )
} catch (error) {
  // Without the page's code there is nothing else to show. The error still reaches the console.
  root.textContent = 'This page could not be loaded. Reload the page to try again.'
  throw error
}

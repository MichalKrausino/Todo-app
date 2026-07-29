import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { initSync } from './sync/engine'
import './index.css'

registerSW({ immediate: true })
initSync()

// Požádat o trvalé úložiště, aby Safari nemohlo IndexedDB vyčistit (viz docs/PLAN.md).
if (navigator.storage?.persist) {
  void navigator.storage.persist()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

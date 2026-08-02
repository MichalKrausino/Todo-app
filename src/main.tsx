import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { reconcileTemplates } from './db/templates'
import { initCalendar } from './sync/calendar'
import { initSync } from './sync/engine'
import './index.css'

registerSW({ immediate: true })
initSync()
initCalendar()

// Generování instancí šablon: při startu a při návratu do popředí
// (přes noc se posunul horizont, mohly přijít změny ze syncu).
void reconcileTemplates()
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void reconcileTemplates()
})

// Požádat o trvalé úložiště, aby Safari nemohlo IndexedDB vyčistit (viz docs/PLAN.md).
if (navigator.storage?.persist) {
  void navigator.storage.persist()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

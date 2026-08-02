import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { reconcileTemplates } from './db/templates'
import { initCalendar } from './sync/calendar'
import { initSync } from './sync/engine'
import './index.css'

// Aktualizace PWA: nová verze se stáhne a aktivuje sama. Bez tohohle by si
// appka na ploše držela starou cache, dokud by ji iOS náhodně neobnovil —
// takhle se novinky projeví při prvním návratu do appky.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return
    const check = () => void registration.update().catch(() => {})
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check()
    })
    setInterval(check, 15 * 60_000)
  },
})
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

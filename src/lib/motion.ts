// Klidový režim (Nastavení → Zpřístupnění → Omezit pohyb) musí zastavit
// VŠECHNO, i animace z knihovny motion — ta v režimu "user" nechává
// běžet průhlednost a barvy, a audit chování by je napočítal jako běžící.
// Komponenty se proto ptají tady a v klidu kreslí rovnou konečný stav.
export const klidovyRezim = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

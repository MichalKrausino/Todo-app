// Ruční kontrola nové verze appky.
//
// Servisní worker se aktualizuje sám (main.tsx: při návratu do popředí a
// každých patnáct minut), ale člověk nemá jak poznat, jestli se to stalo,
// a GitHub Pages umí starou verzi držet v cache ještě pár minut po
// nasazení. Tlačítko v nastavení proto zkontroluje hned a řekne, na čem
// je: „máš nejnovější", nebo „stahuji novou, za chvíli se obnovím".

let registrace: ServiceWorkerRegistration | null = null

export function nastavRegistraci(r: ServiceWorkerRegistration | null): void {
  registrace = r
}

export type VysledekAktualizace = 'nova' | 'aktualni' | 'nelze'

export async function zkontrolujAktualizaci(): Promise<VysledekAktualizace> {
  const r = registrace
  if (!r) return 'nelze'
  try {
    await r.update()
  } catch {
    return 'nelze'
  }
  if (!r.installing && !r.waiting) return 'aktualni'
  // Nový worker má skipWaiting + clientsClaim a registrace v autoUpdate
  // režimu stránku po převzetí obnoví sama. Kdyby to z nějakého důvodu
  // nepřišlo (iOS umí spolknout controllerchange), obnovíme se sami.
  const cekej = new Promise<void>((res) => {
    navigator.serviceWorker?.addEventListener('controllerchange', () => res(), { once: true })
    setTimeout(res, 8000)
  })
  void cekej.then(() => window.location.reload())
  return 'nova'
}

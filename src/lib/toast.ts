// Krátká zpráva u doku — a hlavně nabídka vrátit, co se právě stalo.
//
// PROČ TO NAHRAZUJE POTVRZOVACÍ DIALOGY
//
// Appka na ploše iPhonu vypadá jako nativní, dokud nevyskočí `confirm()`
// — systémový alert s adresou webu. Rozbije iluzi a nic nevyřeší: kdo se
// ptá pokaždé, toho člověk odklepne po očku a smaže omylem stejně.
//
// Lepší je nezdržovat a nechat to vrátit. Mazání je v téhle appce tombstone
// (`deletedAt`), takže vrácení není trik, jen zrušení razítka — a projde
// synchronizací na druhé zařízení jako každá jiná změna.
//
// Store je záměrně na jeden toast: dva najednou by se u doku překrývaly.
// Nový nahradí starý, protože zajímavá je poslední akce.

export interface ToastAkce {
  popisek: string
  kdyz: () => void
}

export interface Toast {
  // Roste s každou zprávou — komponenta podle něj restartuje animaci,
  // i když se text náhodou neliší.
  id: number
  text: string
  akce: ToastAkce[]
}

export interface ToastStav {
  toast: Toast | null
  // Odchod je vidět (sklouzne dolů), teprve pak se odmontuje.
  odchazi: boolean
}

// 5,7 s: dost na přečtení a klepnutí, ale ne tak dlouho, aby zpráva
// visela u doku, když už člověk dělá něco jiného.
const ZIVOTNOST = 5700
const ODCHOD = 300

let stav: ToastStav = { toast: null, odchazi: false }
let poradi = 0
let casovac: ReturnType<typeof setTimeout> | undefined
const odberatele = new Set<() => void>()

const oznam = () => {
  for (const cb of odberatele) cb()
}

const nastav = (novy: ToastStav) => {
  stav = novy
  oznam()
}

export const getToast = (): ToastStav => stav

export function subscribeToast(cb: () => void): () => void {
  odberatele.add(cb)
  return () => {
    odberatele.delete(cb)
  }
}

export function ukazToast(text: string, akce: ToastAkce[] = []): void {
  clearTimeout(casovac)
  poradi += 1
  nastav({ toast: { id: poradi, text, akce }, odchazi: false })
  casovac = setTimeout(() => {
    nastav({ toast: stav.toast, odchazi: true })
    casovac = setTimeout(() => nastav({ toast: null, odchazi: false }), ODCHOD)
  }, ZIVOTNOST)
}

// Zavření bez animace — po klepnutí na akci má zpráva zmizet hned,
// protože co říkala, se právě stalo.
export function skryjToast(): void {
  clearTimeout(casovac)
  nastav({ toast: null, odchazi: false })
}

// Nejčastější případ: „něco jsem smazal, tady je cesta zpátky".
export function nabidniVraceni(text: string, vratit: () => void | Promise<void>): void {
  ukazToast(text, [{ popisek: 'Vrátit', kdyz: () => void vratit() }])
}

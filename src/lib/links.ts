// Odkazy v textu úkolu (název i poznámka). Marketér do poznámky lepí
// Canvu, Drive, brief — a bez tohohle by je z appky musel opisovat.
// Čistá logika: vytáhne URL, uklidí interpunkci za ním a dá mu krátký
// popisek (doména), který se vejde na řádek úkolu.

export interface Odkaz {
  url: string
  /** doména bez „www." — to jediné, co se na řádku vejde */
  popisek: string
}

// http(s)://… nebo holé www.… — mezera, uvozovka a ostrá závorka ho končí.
const RE_ODKAZ = /(?:https?:\/\/|www\.)[^\s<>"'`]+/gi
// Tečka, čárka nebo závorka za odkazem patří větě, ne adrese.
const RE_KONEC = /[.,;:!?)\]]+$/

function uklid(syrove: string): string {
  let url = syrove.replace(RE_KONEC, '')
  // Závorka na konci se ale vrátí, když ji odkaz sám otevřel — Wikipedia
  // a Notion takové adresy mají.
  const oteviracich = (url.match(/\(/g) ?? []).length
  const zaviracich = (url.match(/\)/g) ?? []).length
  if (oteviracich > zaviracich && syrove.slice(url.length).startsWith(')')) url += ')'
  return url
}

function popisek(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function najdiOdkazy(...texty: Array<string | undefined>): Odkaz[] {
  const vysledek: Odkaz[] = []
  const videno = new Set<string>()
  for (const text of texty) {
    if (!text) continue
    for (const nalez of text.match(RE_ODKAZ) ?? []) {
      const cisty = uklid(nalez)
      if (!cisty || /^https?:\/\/$/i.test(cisty) || /^www\.$/i.test(cisty)) continue
      const url = /^www\./i.test(cisty) ? `https://${cisty}` : cisty
      if (videno.has(url)) continue
      videno.add(url)
      vysledek.push({ url, popisek: popisek(url) })
    }
  }
  return vysledek
}

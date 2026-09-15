// Slučování spouštěčů synchronizace — čistá logika s testy.
//
// O sync si říká pět různých míst: návrat signálu, návrat do popředí, tik
// plánovače, zápis přes repo a přihlášení. Dvě z nich přitom přijdou
// v TÉMŽE dispatchi — `online` se poslouchá v enginu i v plánovači —
// takže bez slučování se plný průchod (pull všech tabulek plus push všech
// tabulek) udělá dvakrát hned po sobě. Přesně ve chvíli, kdy je signál
// nejčerstvější a nejkřehčí.
//
// Nestačí na to prosté „už běžím, zahoď". Zápis, který přijde v půlce
// běhu, se MUSÍ doběhnout znovu: push posílá to, co našel na začátku,
// takže by úkol založený během syncu čekal až na další tik. Proto se
// rozlišuje, kdo o sync požádal:
//
//   spouštěč (tik, signál, popředí)  → připoj se k běžícímu, nic navíc
//   zápis přes repo                  → po doběhnutí běž ještě jednou
//
// Zápis, který přišel PŘED startem běhu, žádný druhý běh nepotřebuje —
// ten spuštěný ho pobere, protože čte aktuální Dexie. Proto se příznak
// na začátku běhu nuluje.

export interface Koalescence {
  /**
   * Spustí běh, nebo se připojí k tomu, který už jede.
   * `zZapisu` říká, že podnětem byla změna dat, ne pouhý spouštěč.
   */
  spust(bezet: () => Promise<void>, zZapisu?: boolean): Promise<void>
  /** Jede právě teď běh? (diagnostika a testy) */
  bezi(): boolean
}

export function vytvorKoalescenci(): Koalescence {
  let beh: Promise<void> | null = null
  let cekaZapis = false

  const spust = (bezet: () => Promise<void>, zZapisu = false): Promise<void> => {
    if (zZapisu) cekaZapis = true
    if (beh) return beh

    // Běh, který teď startuje, pobere i zápis, který dorazil před ním.
    cekaZapis = false
    beh = bezet().finally(() => {
      beh = null
      if (cekaZapis) {
        cekaZapis = false
        // Dodatečný běh nikdo nečeká, takže si svoje selhání musí spolknout
        // sám — jinak by z něj bylo neodchycené odmítnutí.
        void spust(bezet).catch(() => {})
      }
    })
    return beh
  }

  return { spust, bezi: () => beh !== null }
}

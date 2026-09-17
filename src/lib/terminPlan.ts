// Co se stane s naplánováním, když člověk přepíše Termín.
//
// PROČ TO EXISTUJE
//
// Úkol umí nést dvě data: `dueDate` (Termín — kdy to má být hotové) a
// `scheduledFor` (naplánování — kdy to udělám). „Kdy to je" se pak počítá
// jako DŘÍVĚJŠÍ z obou (`denUkolu` ve vseSkupiny.ts), a to je jedno
// pravidlo pro celou appku.
//
// Jenže naplánování si ve většině případů nenastavuje člověk — razítkuje
// ho appka: přijatý ranní návrh ho dá na dnešek, večerní uzávěrka na
// zítřek. A v detailu ho ani nemusí být vidět: slot „Naplánovat na jiný
// den" stojí na konci vodorovné řádky, takže na úzkém displeji leží za
// hranou.
//
// Změřeno na skutečných datech: ze třinácti otevřených úkolů
// s naplánováním jich dvanáct nemá žádný termín. Ten jediný, co měl obě
// data, byl přesně ten, který se rozbil: termín přepsaný na neděli
// 20. 9., naplánování pořád na pátku 18. — a protože se bere dřívější
// z obou, zůstal úkol viset na Dnes. Člověk posunul termín o dva dny
// a v appce se nezměnilo nic. Nešlo to ani poznat: to, co ho tam drží,
// nebylo na obrazovce vidět.
//
// PRAVIDLO: POSLEDNÍ RUČNÍ ROZHODNUTÍ VYHRÁVÁ
//
// Když člověk přepíše Termín a naplánování nechá být, je naplánování
// překonané — plánoval si den pro úkol, který od té chvíle patří jinam.
// Zahodí se, takže úkol jde tam, kam ho člověk poslal.
//
// Naplánování se NEZAHAZUJE ve třech případech:
//
//   1. Člověk s ním v témže panelu sám pohnul. Pak jsou to dvě vědomá
//      rozhodnutí vedle sebe („termín je neděle, dělat to budu v pátek")
//      a appka do nich nemá co mluvit.
//   2. Termín se nezměnil. Není proč.
//   3. Termín se SMAZAL. To je „tohle nemá deadline", ne „tohle je jindy";
//      den, který si na to člověk vyhradil, tím neztrácí smysl.
//
// Zahození, ne srovnání na tentýž den: `scheduledFor` je vrstva navrch
// a dvě stejná data na jednom úkolu nic neříkají. Navrch to uvolní
// i zabraný blok v kalendáři „Todo" — o to se stará volající stávající
// cestou (`deleteBlockForTask`, když po uložení žádné naplánování nezbude).

export type ZmenaTerminu = {
  /** Termín, se kterým se panel otevřel. */
  puvodniTermin?: string
  /** Termín po úpravě. */
  novyTermin?: string
  /** Naplánování, se kterým se panel otevřel. */
  puvodniPlan?: string
  /** Naplánování po úpravě — tedy i to, se kterým člověk sám pohnul. */
  novyPlan?: string
}

/** Prázdný řetězec z pole je totéž co „nevyplněno". */
const den = (d?: string): string | undefined => (d ? d : undefined)

/**
 * Vrátí naplánování, které se má uložit — tedy `novyPlan`, nebo
 * `undefined`, když ho přepsaný termín překonal.
 */
export function planPoZmeneTerminu(zmena: ZmenaTerminu): string | undefined {
  const puvodniTermin = den(zmena.puvodniTermin)
  const novyTermin = den(zmena.novyTermin)
  const puvodniPlan = den(zmena.puvodniPlan)
  const novyPlan = den(zmena.novyPlan)

  if (!novyPlan) return undefined
  // (1) člověk s naplánováním sám pohnul — jeho volba je poslední slovo
  if (novyPlan !== puvodniPlan) return novyPlan
  // (2) termín se nezměnil
  if (novyTermin === puvodniTermin) return novyPlan
  // (3) termín se smazal, ne přesunul
  if (!novyTermin) return novyPlan

  return undefined
}

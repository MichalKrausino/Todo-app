// Odkládání — kdy je posun termínu ještě plán a kdy už jen odklad.
//
// Appka počítá `postponeCount` odjakživa (razítkuje ho `updateTask` při
// posunu termínu na později) a mluví o něm na dvou místech: v signálech
// na Dnes a v týdenním ohlédnutí. Jenže obojí je REKAPITULACE — řekne to
// večer nebo v neděli, tedy nikdy ve chvíli, kdy člověk zrovna posouvá
// termín potřetí.
//
// CO ŘÍKAJÍ SKUTEČNÁ DATA
//
// Měřeno na 46 úkolech provozu (celá historie appky), dokončení podle
// počtu odkladů:
//
//   | odkladů | úkolů | hotovo      | průměr dnů v appce |
//   |---------|-------|-------------|--------------------|
//   |    0    |  27   | 22 (81 %)   |        3,7         |
//   |    1    |  14   |  7 (50 %)   |        4,1         |
//   |   2+    |   5   |  0 (0 %)    |       18–21        |
//
// Ani jeden úkol odložený dvakrát a víc se zatím nedodělal. Odklad tedy
// není neutrální „udělám to jindy": od druhého je to spolehlivá známka,
// že se úkol v týhle podobě dělat nebude — bývá moc velký („Jak měřit
// konverze?" je téma, ne úkol) nebo prostě nedůležitý.
//
// Appka proto **neschovává, kolikrát se úkol už posouval, ve chvíli,
// kdy ho člověk posouvá znovu**. Nic nezakazuje a odkladová tlačítka
// zůstávají první — jen je u nich vidět, co se děje. Cesty ven, které
// fungují, už v appce jsou: rozdělit na kroky (checklist v detailu)
// a „Už neplatí" o dvě tlačítka níž.

import type { Task } from '../db/types'

/**
 * Od kolika odkladů se o tom mluví. Dvojka je z měření výš, ne z citu:
 * je to přesně ta hranice, za kterou se v datech nedodělalo nic.
 *
 * Signály na Dnes mají práh o jedna vyšší (`POSTPONE_THRESHOLD`): tam
 * jde o seznam, který se ukazuje sám od sebe, a ten má zůstat vzácný.
 * Tady jde o jeden konkrétní úkol, který má člověk zrovna před očima —
 * tam to není hluk, ale kontext rozhodnutí.
 */
export const PRAH_ODKLADU = 2

/** Byl už tenhle úkol odkládaný tolikrát, že to stojí za zmínku? */
export const jeLezak = (t: Pick<Task, 'postponeCount'>): boolean =>
  (t.postponeCount ?? 0) >= PRAH_ODKLADU

/** „odloženo 4×", nebo prázdno, když se ještě neodkládal dost. */
export const popisOdkladu = (t: Pick<Task, 'postponeCount'>): string =>
  jeLezak(t) ? `odloženo ${t.postponeCount}×` : ''

/**
 * Kolik odkládaných úkolů se nakonec dodělalo — z CELÉ historie, ne jen
 * z tohohle týdne. Tohle číslo si appka nevymýšlí ani nezobecňuje: je
 * to jeho vlastní bilance, a proto patří do ohlédnutí, kde jsou čísla
 * k zamyšlení.
 *
 * Zahozené (`dropped`) se počítají mezi „nedodělané" schválně — škrtnutí
 * je poctivý konec, ale úkol se neudělal a tahle věta je právě o tom.
 */
export function dokonceniPodleOdkladu(tasks: Task[]): { odlozenych: number; hotovych: number } {
  const odlozene = tasks.filter((t) => !t.deletedAt && jeLezak(t))
  return {
    odlozenych: odlozene.length,
    hotovych: odlozene.filter((t) => t.status === 'done').length,
  }
}

const CISLOVKY = ['žádný', 'jeden', 'dva', 'tři', 'čtyři', 'pět', 'šest', 'sedm', 'osm', 'devět']
// Předložka jde s číslovkou, ne zvlášť: česky je „ze čtyř", ale „z pěti".
// Odvozovat to pravidlem by znamenalo psát výjimky pro shluky souhlásek;
// devět tvarů je kratší než ten pokus.
const Z_CISLOVKY = [
  'z nuly',
  'z jednoho',
  'ze dvou',
  'ze tří',
  'ze čtyř',
  'z pěti',
  'ze šesti',
  'ze sedmi',
  'z osmi',
  'z devíti',
]

/**
 * Věta do týdenního ohlédnutí, nebo `undefined`, když je odkládaných
 * úkolů tak málo, že by to nebyla bilance, ale náhoda (`MIN_VZOREK`).
 * Čísla do deseti se píšou slovem — „0 z 5" vypadá jako skóre zápasu.
 */
export const MIN_VZOREK = 3

export function vetaOOdkladani(tasks: Task[]): string | undefined {
  const { odlozenych, hotovych } = dokonceniPodleOdkladu(tasks)
  if (odlozenych < MIN_VZOREK) return undefined
  const kolik = hotovych < CISLOVKY.length ? CISLOVKY[hotovych] : String(hotovych)
  const zKolika = odlozenych < Z_CISLOVKY.length ? Z_CISLOVKY[odlozenych] : `z ${odlozenych}`
  return `Z úkolů, které jsi odložil aspoň dvakrát, se ti zatím dodělal ${kolik} ${zKolika}.`
}

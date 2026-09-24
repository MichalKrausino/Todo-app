// Odkládání — tři různé věci pod jedním slovem.
//
// Appka počítá `postponeCount` odjakživa (razítkuje ho `updateTask` při
// posunu termínu na pozdější den). První verze tohohle modulu z něj
// udělala varování: od druhého odkladu se u úkolu v triáži rozsvítilo
// „odloženo 5×". Opíralo se to o měření — z úkolů odložených dvakrát
// a víc se zatím nedodělal ani jeden (u neodložených 81 %, u jednou
// odložených 50 %) — a přesto z toho vyšel špatný závěr.
//
// PROTOŽE ODKLAD NENÍ JEDNA VĚC
//
// Jsou nejmíň tři důvody, proč se termín posune:
//   1. prokrastinace,
//   2. nestihl jsem to,
//   3. „vím, že to budu muset udělat, ale ne teď" — úkol se zapíše
//      proto, aby nezapadl, a posouvá se do doby, kdy na něj bude čas.
//
// První dva appka od sebe nerozezná a je to tak dobře: soudit ze záznamu
// v databázi, jestli byl člověk líný, nebo měl den navíc práce, je
// hazard. Ten TŘETÍ ale rozeznat jde — a hlavně to není selhání, ale
// funkční způsob, jak si věc připomínat. Pozná se po termínu: termín je
// slib danému dni, kdežto naplánování je den, který si člověk vybral sám
// (a často mu ho vybrala appka — ranní návrh, večerní uzávěrka).
//
// Změřeno na týchž datech, jen rozdělených podle toho, jestli tam termín
// je — úkoly odložené dvakrát a víc:
//
//   | s termínem | bez termínu |
//   |------------|-------------|
//   |   1 úkol   |   4 úkoly   |
//
// Čtyři z pěti „ležáků" žádný termín nemají, takže by značka mířila
// hlavně na parkoviště. `POSTPONE_THRESHOLD` (3) v signálech na Dnes na
// tom byl ještě hůř: OBA úkoly, které ho dnes přetahují, jsou bez
// termínu — ten signál svítil výhradně na vědomě odložené věci.
//
// Pravidlo je proto totéž, které appka už používá nad seznamem
// propadlých („po termínu" vs „nestihnuto", `vseUkoly.ts`): MLUVÍ SE JEN
// O SLIBECH. U odkládaného termínu je počet fakt, který ve chvíli
// rozhodování něco znamená. Odkládaný úkol bez termínu značku nedostane
// — dostane NABÍDKU: sundat datum, ať se přestane tvářit jako propadlý
// a připomíná se tam, kam patří (Bez termínu, ranní návrh, Vše). To je
// „Bez data" v triáži.
//
// Nic se přitom nezakazuje a odkladová tlačítka zůstávají první. Appka
// jen přestala vydávat jeden mechanismus za dva a druhý z nich za chybu.

import type { Task } from '../db/types'

/**
 * Termín je slib danému dni. Naplánování slib není — je to den, který
 * sis vybral sám, a nestihnout vlastní plán je běžný čtvrtek.
 */
export const jeSlib = (t: Pick<Task, 'dueDate'>): boolean => Boolean(t.dueDate)

/**
 * Od kolika odkladů se o tom mluví. Dvojka je z měření, ne z citu: je to
 * hranice, za kterou se v datech přestalo dodělávat.
 *
 * Signály na Dnes mají práh o jedna vyšší (`POSTPONE_THRESHOLD`): tam jde
 * o seznam, který se ukazuje sám od sebe, a ten má zůstat vzácný. Tady
 * jde o jeden konkrétní úkol, který má člověk zrovna před očima — tam to
 * není hluk, ale kontext rozhodnutí.
 */
export const PRAH_ODKLADU = 2

/** Odkládaný SLIB — jediný odklad, o kterém appka mluví. */
export const jeOdkladanySlib = (t: Pick<Task, 'postponeCount' | 'dueDate'>): boolean =>
  jeSlib(t) && (t.postponeCount ?? 0) >= PRAH_ODKLADU

/**
 * Odkládaný úkol BEZ termínu — parkoviště, ne selhání. Appka ho
 * neoznačkuje; nabídne mu, že z něj sundá datum (viz „Bez data" v triáži).
 */
export const jeParkovany = (t: Pick<Task, 'postponeCount' | 'dueDate'>): boolean =>
  !jeSlib(t) && (t.postponeCount ?? 0) >= PRAH_ODKLADU

/** „odloženo 4×", nebo prázdno, když o tom není co říct. */
export const popisOdkladu = (t: Pick<Task, 'postponeCount' | 'dueDate'>): string =>
  jeOdkladanySlib(t) ? `odloženo ${t.postponeCount}×` : ''

/**
 * Kolik odkládaných SLIBŮ se nakonec dodělalo — z celé historie, ne jen
 * z tohohle týdne. Tohle číslo si appka nevymýšlí ani nezobecňuje: je to
 * jeho vlastní bilance, a proto patří do ohlédnutí, kde jsou čísla
 * k zamyšlení.
 *
 * Zahozené (`dropped`) se počítají mezi „nedodělané" schválně — škrtnutí
 * je poctivý konec, ale úkol se neudělal a tahle věta je právě o tom.
 */
export function dokonceniPodleOdkladu(tasks: Task[]): { odlozenych: number; hotovych: number } {
  const odlozene = tasks.filter((t) => !t.deletedAt && jeOdkladanySlib(t))
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
 * slibů tak málo, že by to nebyla bilance, ale náhoda (`MIN_VZOREK`).
 * Čísla do deseti se píšou slovem — „0 z 5" vypadá jako skóre zápasu.
 */
export const MIN_VZOREK = 3

export function vetaOOdkladani(tasks: Task[]): string | undefined {
  const { odlozenych, hotovych } = dokonceniPodleOdkladu(tasks)
  if (odlozenych < MIN_VZOREK) return undefined
  const kolik = hotovych < CISLOVKY.length ? CISLOVKY[hotovych] : String(hotovych)
  const zKolika = odlozenych < Z_CISLOVKY.length ? Z_CISLOVKY[odlozenych] : `z ${odlozenych}`
  return `Z úkolů s termínem, které jsi odložil aspoň dvakrát, se ti zatím dodělal ${kolik} ${zKolika}.`
}

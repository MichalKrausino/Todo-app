// Rozpad projektu na kroky (Fáze 5) — návrh kroků z toho, co už jsi jednou
// udělal.
//
// Proč zrovna takhle: markeťák dělá tentýž projekt opakovaně pro různé
// klienty. „Rebranding webu" u druhého klienta má skoro tytéž kroky jako
// u prvního — jenže ty kroky jsou schované v projektu, který je dávno
// uzavřený, a nikdo je odtamtud ručně nepřepisuje. Tohle je vytáhne.
//
// Zdrojem je VÝHRADNĚ vlastní historie. Vymýšlet obecné kroky
// („Zadání / Návrh / Realizace / Vyhodnocení") by šlo, ale je to přesně
// ten hluk, který se z appky maže druhý den. Když se nic nepodobá,
// nenabídne se nic — ticho je správná odpověď, ne chybějící funkce.
//
// Model přes předplatné sem později přibude jako DALŠÍ zdroj kroků;
// mechanismus (návrh → přijetí po jednom → úkoly) na něj nečeká.

/** Projekt, ze kterého se dá čerpat: jeho jméno, cíl a názvy úkolů. */
export interface ZdrojProjekt {
  id: string
  name: string
  goal?: string
  /** jméno klienta — kvůli popisku „podle … u Alzy" */
  clientName?: string
  /** názvy úkolů v pořadí, v jakém mají vzniknout */
  ukoly: string[]
}

export interface Krok {
  title: string
  /** id projektu, ze kterého krok pochází */
  zdrojId: string
  /** proč je navržený — člověk to vidí u každého kroku */
  duvod: string
}

/** Kolik kroků se nejvýš nabídne. Dvacet řádků není návrh, to je zase seznam. */
export const STROP_KROKU = 10

/** Jak moc se musí jména shodovat, aby šlo o „tentýž projekt jinde". */
export const PRAH_SHODY = 0.5

// Slova, která o povaze práce neříkají nic — bez nich by „Kampaň pro Alzu"
// a „Report pro Bosch" sdílely „pro" a tvářily se jako příbuzné.
const SPOJKY = new Set([
  'a', 'i', 'do', 'k', 'ke', 'na', 'nad', 'o', 'od', 'po', 'pod', 'pro',
  'pri', 's', 'se', 'u', 'v', 've', 'z', 'za', 'ze', 'the', 'of',
])

const bezDiakritiky = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** Jméno na množinu porovnatelných slov: bez diakritiky, spojek a krátkých zbytků. */
export function slova(text: string, vynech: Iterable<string> = []): Set<string> {
  const zakazane = new Set<string>()
  for (const v of vynech) for (const w of bezDiakritiky(v).split(/[^a-z0-9]+/)) if (w) zakazane.add(w)
  const out = new Set<string>()
  for (const w of bezDiakritiky(text).split(/[^a-z0-9]+/)) {
    if (w.length < 2 || SPOJKY.has(w) || zakazane.has(w)) continue
    out.add(w)
  }
  return out
}

/**
 * Jak moc se dvě jména překrývají: průnik proti té menší množině.
 * Schválně ne Jaccard — „Rebranding webu" a „Rebranding webu pro e-shop"
 * jsou tentýž projekt, jen jeden má delší jméno, a Jaccard by je rozdělil.
 */
export function shoda(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let prunik = 0
  for (const w of a) if (b.has(w)) prunik++
  return prunik / Math.min(a.size, b.size)
}

/**
 * Kroky navržené pro `cil` podle podobných projektů v `historie`.
 * `uzMa` jsou názvy úkolů, které v projektu už jsou — ty se nenabízejí
 * znovu. `jmenaKlientu` se z porovnání vyškrtnou, aby „PPC Alza" a
 * „PPC Bosch" byly příbuzné a „PPC Alza" a „SEO Alza" ne.
 */
export function navrhniKroky(
  cil: { name: string; goal?: string; clientName?: string },
  historie: ZdrojProjekt[],
  uzMa: string[] = [],
  jmenaKlientu: string[] = [],
  strop: number = STROP_KROKU,
): Krok[] {
  const cilova = slova(`${cil.name} ${cil.goal ?? ''}`, jmenaKlientu)
  if (!cilova.size) return []

  const podobne = historie
    .map((p) => ({ p, mira: shoda(cilova, slova(`${p.name} ${p.goal ?? ''}`, jmenaKlientu)) }))
    .filter(({ p, mira }) => mira >= PRAH_SHODY && p.ukoly.length > 0)
    // Nejpodobnější napřed; při shodě ten, který má co nabídnout.
    .sort((x, y) => y.mira - x.mira || y.p.ukoly.length - x.p.ukoly.length)

  const videno = new Set<string>()
  for (const t of uzMa) videno.add(bezDiakritiky(t).trim())

  const out: Krok[] = []
  for (const { p } of podobne) {
    for (const title of p.ukoly) {
      if (out.length >= strop) return out
      const klic = bezDiakritiky(title).trim()
      if (!klic || videno.has(klic)) continue
      videno.add(klic)
      out.push({ title, zdrojId: p.id, duvod: duvodZProjektu(p, cil.clientName) })
    }
  }
  return out
}

// Jméno klienta stojí za oddělovačem, ne ve větě: „u Alzy" by chtělo
// druhý pád a ten se u libovolných jmen („Bosch", „V Bílém", „Ondra Fréz")
// spolehlivě neuhodne. Tečka to řeší a je to táž interpunkce, jakou appka
// používá všude jinde („2 úkoly · 1 schůzka · ~3 h").
//
// U vlastního klienta se jméno vynechává: „· Alza" pod každým krokem na
// obrazovce klienta Alza neříká nic, jen třikrát zopakuje, kde jsem.
// Smysl má teprve tehdy, když se kroky berou od někoho jiného.
const duvodZProjektu = (p: ZdrojProjekt, klientCile?: string): string =>
  p.clientName && p.clientName !== klientCile
    ? `podle „${p.name}" · ${p.clientName}`
    : `podle „${p.name}"`

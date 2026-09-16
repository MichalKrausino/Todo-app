// „Čí to je" — čistá logika týmové práce (Fáze 10), pokrytá testy.
//
// PROČ TO VŮBEC JE
//
// Sdílení klienta (Fáze 9) umělo jednu věc: OBA VIDÍ TOTÉŽ. To je
// viditelnost, ne týmová práce, a rozbíjelo to appku ve třech místech:
//
//  1. Nikdo nic nevlastnil. Dva lidé koukali na týž seznam a ani jeden
//     nevěděl, co z toho je na něm — takže se buď oba spoléhali na toho
//     druhého, nebo dělali totéž dvakrát.
//  2. Dnes se plnilo cizí prací. `openTasks()` vrací všechno, na co appka
//     dosáhne, takže kolegův úkol spadl do mého dneška, do počtu
//     propadlých, do kroužku postupu i do pruhu zátěže v Plánu. Kroužek
//     tím začal lhát: den nešel dodělat, protože půlka nebyla moje.
//  3. Osobní vrstvy byly společné. `scheduledFor`, `pinnedFor` a
//     `postponeCount` odpovídají na „kdy to udělám JÁ" a seděly na
//     sdíleném řádku — jedno políčko pro dva lidi. Kolega si úkol připnul
//     do svých Top 3 a připnul ho tím i mně.
//
// Všechno tři řeší jediný údaj: KDO TO MÁ. A to třetí mimochodem: jakmile
// má úkol v každé chvíli právě jednoho člověka, má osobní vrstvu kdo
// vyplnit a nikdo jiný jí nesahá. Není proto potřeba stavět druhou,
// per-uživatelskou vrstvu dat — stačí přiřazení.
//
// ODVOZENÍ, NE NASTAVENÍ
//
// „Čí to je" se NEUKLÁDÁ u každého úkolu. Kdyby se ukládalo, musel by se
// při zavedení přiřazení projít celý archiv a každému úkolu někoho dopsat
// — a komu by se dopsal u člověka, který nic nesdílí? Místo toho se čte
// ze dvou údajů, které už existují:
//
//   assignedTo  — komu to bylo výslovně dané (přebíjí)
//   ownerId     — kdo úkol založil (razítko ze serveru, viz merge.ts)
//
// Tím to vychází správně samo od sebe ve všech případech, na kterých se to
// dá pokazit: kdo nic nesdílí, má všechno svoje (nic není přiřazené a
// zakladatel je on); kdo klienta právě nasdílel, si svoje úkoly nechá;
// kolegovy úkoly jsou od začátku kolegovy; a čerstvě založený úkol, který
// ještě neodešel na server, je můj, i když razítko ještě nemá.

export interface KdoUkol {
  ownerId?: string
  assignedTo?: string
}

/**
 * Je úkol můj? Nepřihlášený člověk nic nesdílí, takže je jeho všechno —
 * bez téhle větve by se odhlášené appce vyprázdnil dnešek, jakmile by
 * v ní zůstala stažená data.
 */
export function jeMuj(ukol: KdoUkol, ja: string | undefined): boolean {
  if (!ja) return true
  const kdo = ukol.assignedTo ?? ukol.ownerId
  return !kdo || kdo === ja
}

/** Kdo to má udělat. `undefined` jen u nepřihlášeného. */
export function kdoMa(ukol: KdoUkol, ja: string | undefined): string | undefined {
  return ukol.assignedTo ?? ukol.ownerId ?? ja
}

/** Jen moje práce — podklad pro Dnes a Plán. */
export function mojeUkoly<T extends KdoUkol>(ukoly: readonly T[], ja: string | undefined): T[] {
  if (!ja) return [...ukoly]
  return ukoly.filter((u) => jeMuj(u, ja))
}

/**
 * Jméno pro zobrazení z e-mailu. Ve sdílených datech se nosí id, e-mail
 * se k němu dohledává (src/sync/lide.ts) — a „jana.novakova@firma.cz" je
 * na řádku úkolu k ničemu, tam se vejde jedno slovo.
 *
 * Zkracuje se na první část před tečkou, ale JEN dokud je jednoznačná:
 * dvě Jany vedle sebe jsou přesně ta vada, kvůli které tahle funkce
 * existuje. Při shodě se jde o patro zpátky (celá část před zavináčem)
 * a při shodě i tam se ukáže celý e-mail — dvě různé domény můžou mít
 * tutéž schránku.
 */
export function kratkaJmena(emaily: readonly string[]): Map<string, string> {
  const unikatni = [...new Set(emaily.map((e) => e.trim()).filter(Boolean))]
  const mistni = (e: string) => e.split('@')[0] || e
  const navrh = (e: string) => mistni(e).split('.')[0] || mistni(e)

  const pocty = new Map<string, number>()
  const poctyMistni = new Map<string, number>()
  for (const e of unikatni) {
    pocty.set(navrh(e), (pocty.get(navrh(e)) ?? 0) + 1)
    poctyMistni.set(mistni(e), (poctyMistni.get(mistni(e)) ?? 0) + 1)
  }

  const out = new Map<string, string>()
  for (const e of unikatni) {
    if ((pocty.get(navrh(e)) ?? 0) === 1) out.set(e, navrh(e))
    else if ((poctyMistni.get(mistni(e)) ?? 0) === 1) out.set(e, mistni(e))
    else out.set(e, e)
  }
  return out
}

export interface SkupinaLidi<T> {
  klic: string
  nazev: string
  ukoly: T[]
}

/**
 * Rozdělení seznamu po lidech — třetí poloha přepínače ve Vše.
 *
 * Já jsem první a jmenuju se „Já", ne svým e-mailem: na vlastní obrazovce
 * se člověk nehledá podle adresy. Ostatní jdou podle jména, aby se pořadí
 * neměnilo podle toho, kdo zrovna něco odškrtl.
 *
 * Kdo v mapě jmen není, spadne do „někdo další" — je to reálný stav, ne
 * chyba: úkol může být přiřazený člověku, kterému už sdílení skončilo,
 * a zmizet by neměl (na to je „Přiřazení se ruší se sdílením" v shares.ts,
 * ale v mezičase se o něm nesmí mlčet).
 */
export function skupinyLidi<T extends KdoUkol>(
  ukoly: readonly T[],
  ja: string | undefined,
  jmena: ReadonlyMap<string, string>, // id uživatele → jméno k zobrazení
): Array<SkupinaLidi<T>> {
  const kose = new Map<string, T[]>()
  for (const u of ukoly) {
    const klic = jeMuj(u, ja) ? 'ja' : (kdoMa(u, ja) ?? 'ostatni')
    const kos = kose.get(klic)
    if (kos) kos.push(u)
    else kose.set(klic, [u])
  }

  const nazev = (klic: string) => (klic === 'ja' ? 'Já' : (jmena.get(klic) ?? 'někdo další'))

  return [...kose.entries()]
    .map(([klic, list]) => ({ klic, nazev: nazev(klic), ukoly: list }))
    .sort((a, b) => {
      if (a.klic === 'ja') return -1
      if (b.klic === 'ja') return 1
      return a.nazev.localeCompare(b.nazev, 'cs')
    })
}

/**
 * Přiřazení, která už na nikoho neukazují.
 *
 * Když kolegovi skončí sdílení, zůstanou úkoly přiřazené jemu. Na jeho
 * zařízení se smažou, u mě ale zůstanou ležet — a patří člověku, který
 * na ně nedosáhne. Takový úkol zmizí z MÉHO dneška (je přiřazený jinam)
 * i z jeho (nevidí ho): tiše propadne mezi dvěma lidmi, což je přesně ta
 * ztráta, kvůli které se přiřazení zavádělo.
 *
 * `lideUKlienta` je id lidí u každého SDÍLENÉHO klienta. Klient, který
 * v mapě není, se bere jako nesdílený — tedy jen můj. Volající proto musí
 * mapu poskládat pro všechny sdílené klienty a při jakémkoli selhání
 * úklid vůbec nespouštět: půlka mapy vypadá jako „zbytek nikdo nesdílí".
 *
 * Vlastní přiřazení se nikdy neruší: na svoje úkoly dosáhnu vždycky.
 */
export function zavislaPrirazeni(
  ukoly: readonly { id: string; clientId?: string; assignedTo?: string }[],
  lideUKlienta: ReadonlyMap<string, ReadonlySet<string>>,
  ja: string | undefined,
): string[] {
  return ukoly
    .filter((u) => {
      if (!u.assignedTo || u.assignedTo === ja) return false
      if (!u.clientId) return true // úkol bez klienta se nesdílí vůbec
      const lide = lideUKlienta.get(u.clientId)
      return !lide || !lide.has(u.assignedTo)
    })
    .map((u) => u.id)
}

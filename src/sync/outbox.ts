// Co je potřeba odeslat a co lokálně zahodit — čistá logika, pokrytá testy.
//
// PROČ TO NEJDE PODLE ČASU
//
// Dřív se odesílalo všechno s `updatedAt` za jedním kurzorem a kurzor se
// posouval na nejvyšší odeslané razítko. Jenže mezi odesílanými záznamy
// jsou i ty stažené z druhého zařízení — a to razítkuje SVÝMI hodinami.
// Stačí, aby šly o pár minut napřed, kurzor vyskočí do budoucnosti a
// všechno, co tady mezitím vznikne, je pod ním. Takové změny se neodešlou
// nikdy a nikde to nezasvítí; prostě u druhého člověka nejsou.
//
// Stejně tiše to praskne, když se hodinám srovná čas zpátky (NTP, ruční
// přenastavení): nové zápisy dostanou nižší razítko než kurzor a zmizí.
//
// Proto se tu čas nepoužívá jako kurzor. Vede se evidence po jednotlivých
// záznamech: co jsem odeslal a v jaké verzi. Odesílá se všechno, co se od
// své odeslané verze liší. Hodiny do rozhodování nevstupují vůbec.

export interface Pushable {
  id: string
  updatedAt: string
}

// Verze záznamů, které už jsou na serveru: id → updatedAt při odeslání.
export type PushedVersions = Map<string, string>

// Co odeslat: co server nezná, nebo zná v jiné verzi.
//
// Řadí se vzestupně podle updatedAt. Nutné to není (evidence se vede po
// záznamech, ne kurzorem), ale při výpadku uprostřed odesílání se tím
// dostane ven dřív to starší, což je pořadí, ve kterém to vznikalo.
export function dirtyRecords<T extends Pushable>(records: T[], pushed: PushedVersions): T[] {
  return records
    .filter((r) => pushed.get(r.id) !== r.updatedAt)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
}

// Odeslání dávky s izolací vadného záznamu.
//
// Dávka může spadnout ze dvou úplně jiných důvodů a je zásadní je nesplést:
//   - vypadla síť / vypršelo přihlášení → nesmí projít nic a musí to být
//     vidět jako chyba, jinak by se tvářilo, že je odesláno;
//   - jeden záznam server odmítl (typicky úkol přesunutý pod klienta, ke
//     kterému už nemám právo) → zbytek dávky musí projít. Jinak by jediná
//     nešťastná úprava umlčela odesílání všeho ostatního napořád.
//
// Rozlišuje se to podle výsledku: když po jednotlivém opakování neprojde
// ani jeden záznam z VÍCE zkoušených, je to porucha a vyhodí se chyba.
//
// U jediného záznamu v dávce se to rozlišit nedá — a tam se schválně
// nevyhazuje. Chyba by totiž zastavila odesílání zbylých tabulek, takže
// jeden trvale odmítaný úkol by umlčel celou synchronizaci napořád.
// Nezablokovat je menší zlo: skutečné poruchy stejně spolehlivě spadnou
// dřív, při stahování, které běží před odesíláním.
//
// Za odeslané se hlásí VÝHRADNĚ to, co server skutečně přijal — na tom
// stojí evidence, a špatně nahlášený záznam by se už nikdy neodeslal.
const PROBE = 5

export async function sendWithFallback<T extends Pushable>(
  batch: T[],
  send: (rows: T[]) => Promise<string | null>,
): Promise<{ sent: T[]; refused: number }> {
  const batchError = await send(batch)
  if (!batchError) return { sent: batch, refused: 0 }

  const sent: T[] = []
  let refused = 0
  for (const row of batch) {
    if (await send([row])) {
      refused++
      // Nic neprošlo ani po pár pokusech → není to vadný záznam, ale
      // porucha. Nemá smysl kvůli ní posílat zbytek dávky po jednom.
      if (sent.length === 0 && refused >= PROBE) throw new Error(batchError)
    } else {
      sent.push(row)
    }
  }
  if (sent.length === 0 && batch.length > 1) throw new Error(batchError)
  return { sent, refused }
}

// Záznamy, které lokálně leží, ale server je nezná — a zahodit je je bezpečné.
//
// Vzniknou vždycky, když se zúží rozsah viditelného: majitel přesune úkol
// ze sdíleného klienta jinam, odebere sdílení, přejmenuje… Kurzorový pull
// se o tom nedozví (stahuje jen to, co přibylo), takže by tu jejich kopie
// ležela napořád a strašila jako úkol, který nikdo jiný nevidí.
//
// Zásadní pojistka: co ještě není odeslané, se NEZAHAZUJE. Jinak by úklid
// smazal práci, která vznikla offline a čeká na odeslání — server ji zatím
// nezná úplně stejně jako ten zmizelý cizí záznam, ale znamená to opak.
export function vanishedIds(
  localIds: string[],
  serverIds: ReadonlySet<string>,
  dirtyIds: ReadonlySet<string>,
): string[] {
  return localIds.filter((id) => !serverIds.has(id) && !dirtyIds.has(id))
}

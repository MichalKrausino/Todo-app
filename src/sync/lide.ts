// Kdo je kdo (Fáze 10) — jména k id lidí, se kterými něco sdílím.
//
// Ve sdílených datech se nosí id uživatele, ne e-mail: e-mail by v řádku
// úkolu přečetl každý, kdo na řádek dosáhne. Jenže „u-8f3c…" na řádku
// nikomu nic neřekne, takže se jména dotahují přes `list_client_shares`
// a ukládají do Dexie — v letadle pak u cizího úkolu pořád stojí „jana".
//
// Kdo nic nesdílí, sem nesáhne ani jednou: bez sdíleného klienta není
// koho evidovat a funkce skončí na prvním řádku.

import { db } from '../db/db'
import { mojeId, updateTask } from '../db/repo'
import { zavislaPrirazeni } from '../lib/tymUkoly'
import { listClientShares, sharedClientIds } from './shares'
import { getSyncStatus, subscribeSyncStatus } from './status'

// Jména se mění řádově jednou za život účtu, ne každou minutu. Obnova se
// proto váže na změnu rozsahu sdílení (nový kolega = nový otisk) a jinak
// jede jednou za půl dne jako pojistka. Bez toho by tři sdílení klienti
// znamenali tři dotazy na server při každém tiku plánovače.
const OBNOVA_MS = 12 * 3_600_000

let posledni = 0
let bezi = false
let posledniOtisk = ''

/**
 * Dotáhne jména ke sdíleným klientům a uloží je.
 *
 * Nikdy nemaže: člověk, kterému sdílení skončilo, zůstane v tabulce jako
 * jméno. Je to jediná cesta, jak u úkolu, který mu ještě zůstal přiřazený,
 * ukázat „jana" místo „někdo další" — a cena je jeden řádek s e-mailem
 * v lokální databázi, ne v synchronizovaných datech.
 */
export async function refreshLide(force = false): Promise<void> {
  if (bezi) return
  const ids = [...(await sharedClientIds())]
  const otisk = ids.slice().sort().join(',')
  const zmena = otisk !== posledniOtisk
  if (!force && !zmena && Date.now() - posledni < OBNOVA_MS) return
  if (ids.length === 0) {
    posledniOtisk = otisk
    posledni = Date.now()
    return
  }

  bezi = true
  try {
    const nalezeni = new Map<string, string>()
    const lideUKlienta = new Map<string, Set<string>>()
    let vseDoslo = true
    for (const clientId of ids) {
      const rows = await listClientShares(clientId)
      // Prázdný seznam je u sdíleného klienta nemožný (je v něm vždycky
      // aspoň majitel), takže je to selhání dotazu — a s půlkou mapy se
      // úklid pouštět nesmí.
      if (rows.length === 0) {
        vseDoslo = false
        continue
      }
      lideUKlienta.set(clientId, new Set(rows.map((r) => r.userId).filter(Boolean)))
      for (const osoba of rows) {
        if (osoba.userId && osoba.email) nalezeni.set(osoba.userId, osoba.email)
      }
    }
    if (vseDoslo) await uklidPrirazeni(lideUKlienta)
    // Prázdný výsledek se nezapisuje: znamená to výpadek sítě nebo staré
    // SQL, ne „nikoho neznám". Přepsat tím cache by u všech cizích úkolů
    // zhaslo jméno přesně ve chvíli, kdy je člověk offline.
    if (nalezeni.size > 0) {
      await db.lide.bulkPut([...nalezeni].map(([userId, email]) => ({ userId, email })))
      posledniOtisk = otisk
      posledni = Date.now()
    }
  } catch {
    // Jména jsou ozdoba, ne data — výpadek se nehlásí, jen se zkusí příště.
  } finally {
    bezi = false
  }
}

export function initLide(): void {
  subscribeSyncStatus(() => {
    const s = getSyncStatus()
    if (s.phase === 'idle' && s.lastSyncAt) void refreshLide()
  })
}

/**
 * Zruší přiřazení, která už na nikoho neukazují.
 *
 * Kolegovi skončilo sdílení — na jeho zařízení se úkoly smažou, u mě ale
 * zůstanou přiřazené jemu. Takový úkol nemá nikoho: z mého Dneška vypadl
 * (patří jinam) a do jeho se nedostane (nevidí ho). Propadl by mezi dvěma
 * lidmi potichu, což je přesně to, čemu má přiřazení bránit.
 *
 * Běží tady, protože tohle je jediné místo, kde appka právě teď s jistotou
 * ví, kdo u kterého klienta je. Rozhodování samo je čistá funkce s testy
 * (`zavislaPrirazeni`) — a nikdy nesahá na to, co je přiřazené mně.
 */
async function uklidPrirazeni(lideUKlienta: Map<string, Set<string>>): Promise<void> {
  const ja = await mojeId()
  const ukoly = await db.tasks.filter((t) => !t.deletedAt && !!t.assignedTo).toArray()
  if (ukoly.length === 0) return
  for (const id of zavislaPrirazeni(ukoly, lideUKlienta, ja)) {
    await updateTask(id, { assignedTo: undefined })
  }
}

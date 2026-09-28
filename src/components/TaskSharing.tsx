// Kdo vidí tenhle konkrétní úkol.
//
// Úkol je SOUKROMÝ svému autorovi a sdílí se po jednom, oběma směry —
// majitel klienta kolegovi i kolega majiteli (`src/lib/sdileniUkolu.ts`).
// Dřív to bylo obráceně: sdílený klient = kolega viděl všechno a tady se
// jednotlivé úkoly vyjímaly. „Všechno kromě toho, na co nezapomenu" je ale
// slib, který se jednou poruší — a vzít zpátky, co kolega viděl, nejde.
//
// Zaškrtnuté = vidí. Schválně kladně: „nesdílet" jako zaškrtávátko se čte
// naopak, než se chová, a u něčeho, co pouští data z ruky, je obrácená
// logika ta poslední věc, kterou chceš.
//
// O sdílení rozhoduje AUTOR úkolu. U cizího úkolu, který mi někdo nasdílel,
// je tu jen věta, kdo mi ho dal — server by mi ho stejně nedovolil se
// sebe vyškrtnout (`with check` v supabase/sdileni-ukolu.sql).
//
// Rozhoduje o tom RLS na serveru, ne tahle komponenta: filtr jen v UI by
// úkol pořád posílal do cizího zařízení a stačilo by se podívat do jeho
// IndexedDB.

import { useMemo } from 'react'
import { updateTask } from '../db/repo'
import { komuLzeSdilet, sOdebranym, sPridanym } from '../lib/sdileniUkolu'
import { kratkaJmena } from '../lib/tymUkoly'
import { useJa, useKolegove, useSdilenyKlient, useUmiSdileniUkolu } from '../lib/useTym'

export function TaskSharing({
  taskId,
  clientId,
  ownerId,
  sharedWith,
  onChange,
}: {
  taskId: string
  clientId: string | undefined
  /** Autor úkolu (razítko ze serveru). Bez něj je úkol můj — ještě neodešel. */
  ownerId: string | undefined
  sharedWith: string[]
  onChange: (next: string[]) => void
}) {
  const ja = useJa()
  // Z otisku, ne ze sítě: v letadle se tím pozná, že klient sdílený je,
  // i když seznam kolegů zrovna nedojde. Samotný seznam lidí dává
  // `useKolegove` — sdílený se slotem „Kdo to má", takže se u otevřeného
  // úkolu netahá dvakrát totéž.
  const jeSdileny = useSdilenyKlient(clientId)
  const { lide, nacetlo } = useKolegove(clientId)
  const umi = useUmiSdileniUkolu(clientId)
  const jmena = useMemo(() => kratkaJmena(lide.map((l) => l.email)), [lide])

  if (!jeSdileny) return null

  const mujUkol = !ownerId || ownerId === ja
  const komu = komuLzeSdilet(lide, ja)

  const prepni = (userId: string, vidi: boolean) => {
    const next = (vidi ? sPridanym(sharedWith, userId) : sOdebranym(sharedWith, userId)) ?? []
    onChange(next)
    void updateTask(taskId, { sharedWith: next.length ? next : undefined })
  }

  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-ink-soft">Kdo úkol vidí</span>

      {/* Půlka upgradu: nová appka, staré SQL. Server pak sdílí celého
          klienta a přepínač „Jen já" by lhal o tom, kdo tenhle úkol
          dostane do zařízení. Radši se řekne, co zbývá spustit. */}
      {umi === false && (
        <p className="mb-1.5 rounded-lg bg-note px-3 py-2 text-[12px] text-note-ink">
          Server zatím sdílí celého klienta — kolegové vidí všechny jeho úkoly.
          Sdílení po úkolech začne platit po spuštění
          <code className="px-1">supabase/sdileni-ukolu.sql</code>.
        </p>
      )}

      {!mujUkol ? (
        <p className="rounded-lg bg-well px-3 py-2 text-[13px] text-ink-soft">
          Úkol ti nasdílel{' '}
          <span className="font-medium text-ink">
            {jmena.get(lide.find((l) => l.userId === ownerId)?.email ?? '') ?? 'kolega'}
          </span>
          . Kdo ho ještě vidí, rozhoduje on.
        </p>
      ) : komu.length === 0 ? (
        <p className="rounded-lg bg-well px-3 py-2 text-[13px] text-ink-soft">
          {nacetlo
            ? 'Klienta zatím nesdílíš s nikým dalším.'
            : 'Kolegy se nepodařilo načíst — chce to připojení.'}
        </p>
      ) : (
        <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
          {komu.map((l) => {
            const vidi = sharedWith.includes(l.userId)
            const jmeno = jmena.get(l.email) ?? l.email
            return (
              <label
                key={l.userId}
                className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[15px]">{jmeno}</span>
                  <span className="text-xs text-ink-soft">
                    {vidi ? 'Vidí tenhle úkol' : 'Nevidí — úkol je jen tvůj'}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={vidi}
                  aria-label={`Úkol vidí ${jmeno}`}
                  onChange={(e) => prepni(l.userId, e.target.checked)}
                  className="h-5 w-5 shrink-0"
                />
              </label>
            )
          })}
        </div>
      )}

      {mujUkol && komu.length > 0 && umi !== false && (
        <p className="mt-1 px-1 text-[12px] text-ink-faint">
          Nový úkol je vždycky jen tvůj. Koho nezaškrtneš, ten ho nedostane ani
          do svého zařízení — hlídá to server.
        </p>
      )}
    </div>
  )
}

// Kdo vidí tenhle konkrétní úkol — nebo projekt.
//
// Úkol i projekt jsou SOUKROMÉ svému autorovi a sdílejí se po jednom,
// oběma směry — majitel klienta kolegovi i kolega majiteli
// (`src/lib/sdileniUkolu.ts`). Dřív to bylo obráceně: sdílený klient =
// kolega viděl všechno a tady se jednotlivé úkoly vyjímaly. „Všechno kromě
// toho, na co nezapomenu" je ale slib, který se jednou poruší — a vzít
// zpátky, co kolega viděl, nejde.
//
// Projekt a úkol se sdílejí NEZÁVISLE (Michalova volba): nasdílený projekt
// ukáže kolegovi jen projekt, úkoly v něm se dál vybírají po jednom. A
// nasdílený úkol z projektu, který kolega nevidí, uvidí bez projektu —
// proto ta věta u jména, ať to nepřekvapí.
//
// Zaškrtnuté = vidí. Schválně kladně: „nesdílet" jako zaškrtávátko se čte
// naopak, než se chová, a u něčeho, co pouští data z ruky, je obrácená
// logika ta poslední věc, kterou chceš.
//
// O sdílení rozhoduje AUTOR. U cizího úkolu či projektu, který mi někdo
// nasdílel, je tu jen věta, kdo mi ho dal — server by mi ho stejně
// nedovolil se sebe vyškrtnout (`with check` v SQL).
//
// Rozhoduje o tom RLS na serveru, ne tahle komponenta: filtr jen v UI by
// záznam pořád posílal do cizího zařízení a stačilo by se podívat do jeho
// IndexedDB.

import { useMemo, useState } from 'react'
import { updateProject, updateTask } from '../db/repo'
import type { Project } from '../db/types'
import { komuLzeSdilet, sOdebranym, sPridanym, vidiProjekt } from '../lib/sdileniUkolu'
import { kratkaJmena } from '../lib/tymUkoly'
import {
  useJa,
  useKolegove,
  useSdilenyKlient,
  useUmiSdileniProjektu,
  useUmiSdileniUkolu,
} from '../lib/useTym'

type Co = 'úkol' | 'projekt'

function KdoVidi({
  co,
  clientId,
  ownerId,
  sharedWith,
  umi,
  soubor,
  poznamka,
  onChange,
}: {
  co: Co
  clientId: string | undefined
  /** Autor (razítko ze serveru). Bez něj je záznam můj — ještě neodešel. */
  ownerId: string | undefined
  sharedWith: string[]
  /** Umí server tohle sdílení? `false` = starý server, sdílí celého klienta. */
  umi: boolean | undefined
  /** Které SQL chybí, když `umi === false`. */
  soubor: string
  /** Věta pod jménem, když je vybrané (např. „uvidí bez projektu"). */
  poznamka?: (userId: string) => string | undefined
  onChange: (next: string[]) => void
}) {
  const ja = useJa()
  // Z otisku, ne ze sítě: v letadle se tím pozná, že klient sdílený je,
  // i když seznam kolegů zrovna nedojde. Samotný seznam lidí dává
  // `useKolegove` — sdílený se slotem „Kdo to má", takže se u otevřeného
  // úkolu netahá dvakrát totéž.
  const jeSdileny = useSdilenyKlient(clientId)
  const { lide, nacetlo } = useKolegove(clientId)
  const jmena = useMemo(() => kratkaJmena(lide.map((l) => l.email)), [lide])

  if (!jeSdileny) return null

  const muj = !ownerId || ownerId === ja
  const komu = komuLzeSdilet(lide, ja)
  const tenhle = co === 'úkol' ? 'tenhle úkol' : 'tenhle projekt'

  const prepni = (userId: string, vidi: boolean) => {
    onChange((vidi ? sPridanym(sharedWith, userId) : sOdebranym(sharedWith, userId)) ?? [])
  }

  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-ink-soft">
        {co === 'úkol' ? 'Kdo úkol vidí' : 'Kdo projekt vidí'}
      </span>

      {/* Půlka upgradu: nová appka, staré SQL. Server pak sdílí celého
          klienta a přepínač „Jen já" by lhal o tom, kdo záznam dostane do
          zařízení. Radši se řekne, co zbývá spustit. */}
      {umi === false && (
        <p className="mb-1.5 rounded-lg bg-note px-3 py-2 text-[12px] text-note-ink">
          Server zatím sdílí celého klienta — kolegové vidí{' '}
          {co === 'úkol' ? 'všechny jeho úkoly' : 'všechny jeho projekty'}. Výběr začne
          platit po spuštění
          <code className="px-1">{soubor}</code>.
        </p>
      )}

      {!muj ? (
        <p className="rounded-lg bg-well px-3 py-2 text-[13px] text-ink-soft">
          {co === 'úkol' ? 'Úkol' : 'Projekt'} ti nasdílel{' '}
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
            const pozn = vidi ? poznamka?.(l.userId) : undefined
            return (
              <label
                key={l.userId}
                className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[15px]">{jmeno}</span>
                  <span className="text-xs text-ink-soft">
                    {pozn ?? (vidi ? `Vidí ${tenhle}` : `Nevidí — ${co} je jen tvůj`)}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={vidi}
                  aria-label={`${co === 'úkol' ? 'Úkol' : 'Projekt'} vidí ${jmeno}`}
                  onChange={(e) => prepni(l.userId, e.target.checked)}
                  className="h-5 w-5 shrink-0"
                />
              </label>
            )
          })}
        </div>
      )}

      {muj && komu.length > 0 && umi !== false && (
        <p className="mt-1 px-1 text-[12px] text-ink-faint">
          {co === 'úkol'
            ? 'Nový úkol je vždycky jen tvůj. Koho nezaškrtneš, ten ho nedostane ani do svého zařízení — hlídá to server.'
            : 'Nasdílený projekt ukáže jen sebe — úkoly v něm vybíráš dál po jednom. Nový projekt je vždycky jen tvůj.'}
        </p>
      )}
    </div>
  )
}

export function TaskSharing({
  taskId,
  clientId,
  ownerId,
  sharedWith,
  project,
  onChange,
}: {
  taskId: string
  clientId: string | undefined
  ownerId: string | undefined
  sharedWith: string[]
  /** Projekt úkolu — kvůli větě „uvidí bez projektu". */
  project: Project | undefined
  onChange: (next: string[]) => void
}) {
  const ja = useJa()
  const umi = useUmiSdileniUkolu(clientId)
  const umiProjekty = useUmiSdileniProjektu(clientId)
  return (
    <KdoVidi
      co="úkol"
      clientId={clientId}
      ownerId={ownerId}
      sharedWith={sharedWith}
      umi={umi}
      soubor="supabase/sdileni-ukolu.sql"
      poznamka={(kdo) =>
        project && umiProjekty === true && !vidiProjekt(project, kdo, ja)
          ? `Vidí ho, ale bez projektu — „${project.name}" mu nesdílíš`
          : undefined
      }
      onChange={(next) => {
        onChange(next)
        void updateTask(taskId, { sharedWith: next.length ? next : undefined })
      }}
    />
  )
}

export function ProjectSharing({ project }: { project: Project }) {
  const umi = useUmiSdileniProjektu(project.clientId)
  // Vlastní stav, ne jen prop: panel dostal projekt v okamžiku otevření
  // a přepínač musí reagovat hned, ne až se živý dotaz vrátí.
  const [sharedWith, setSharedWith] = useState(project.sharedWith ?? [])
  return (
    <KdoVidi
      co="projekt"
      clientId={project.clientId}
      ownerId={project.ownerId}
      sharedWith={sharedWith}
      umi={umi}
      soubor="supabase/sdileni-projektu.sql"
      onChange={(next) => {
        setSharedWith(next)
        void updateProject(project.id, { sharedWith: next.length ? next : undefined })
      }}
    />
  )
}

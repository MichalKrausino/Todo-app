// „Rozepsat na kroky" — nabídka kroků z projektu, který už jsi jednou dělal.
//
// Tři věci, které tu drží tvar:
//
// 1. Nabídka se snímá při otevření panelu, ne živým dotazem. Jinak by se
//    pod rukama přerovnávala a visela by nad všemi úkoly ve všech
//    projektech kvůli sekci, která je většinu času sbalená.
// 2. Když se nic nepodobá, není vidět vůbec nic — ani prázdný stav.
//    Ticho je odpověď; prázdný rámeček s větou „zatím nic" by byl další
//    blok na obrazovce, kde se má pracovat.
// 3. Přidání je vratné (tombstone + toast), takže se na nic neptá —
//    žádné systémové dialogy, jako všude jinde v appce. Panel se ale
//    musí ZAVŘÍT DŘÍV, než se toast ukáže: toast má z-40 a plachta
//    panelu z-50, takže „Vrátit" pod otevřeným panelem nejde stisknout
//    (změřeno auditem chování). Uzavření a smazání projektu to dělají
//    stejně — proto si komponenta bere `onHotovo` z render propu Sheetu.

import { useEffect, useState } from 'react'
import type { Project } from '../db/types'
import { navrhKroku, pridejKroky, vratKroky } from '../db/rozpadProjektu'
import type { Krok } from '../lib/rozpad'
import { plural } from '../lib/labels'
import { klidovyRezim } from '../lib/motion'
import { nabidniVraceni } from '../lib/toast'
import { DisclosureContent } from './ui/Disclosure'
import { Button } from './ui/Button'

export function RozpadKroku({ project, onHotovo }: { project: Project; onHotovo: () => void }) {
  const [kroky, setKroky] = useState<Krok[] | null>(null)
  const [vybrane, setVybrane] = useState<Set<string>>(new Set())
  const [otevreno, setOtevreno] = useState(false)
  const [uklada, setUklada] = useState(false)

  useEffect(() => {
    let platne = true
    void navrhKroku(project).then((n) => {
      if (!platne) return
      setKroky(n)
      setVybrane(new Set(n.map((k) => k.title)))
    })
    return () => {
      platne = false
    }
    // Snímek při otevření panelu — na změny v datech se schválně nereaguje.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id])

  if (!kroky || kroky.length === 0) return null

  const prepni = (title: string) => {
    const dal = new Set(vybrane)
    if (dal.has(title)) dal.delete(title)
    else dal.add(title)
    setVybrane(dal)
  }

  const pridat = async () => {
    const vybrano = kroky.filter((k) => vybrane.has(k.title))
    if (!vybrano.length || uklada) return
    setUklada(true)
    const ids = await pridejKroky(project, vybrano)
    setKroky([])
    setOtevreno(false)
    setUklada(false)
    onHotovo()
    nabidniVraceni(
      `${ids.length} ${plural(ids.length, 'krok přidán', 'kroky přidány', 'kroků přidáno')}`,
      () => vratKroky(ids),
    )
  }

  const klid = klidovyRezim()

  return (
    <section>
      <button
        onClick={() => setOtevreno(!otevreno)}
        aria-expanded={otevreno}
        className="-my-1 flex w-full items-center justify-between gap-2 py-2 text-left"
      >
        <span className="section-label">Rozepsat na kroky · {kroky.length}</span>
        <svg
          viewBox="0 0 24 24"
          className={`h-4 w-4 shrink-0 text-ink-faint transition-transform duration-200 ${otevreno ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>

      <DisclosureContent open={otevreno}>
        <div className="space-y-3 pt-1.5">
          <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">
            {kroky.map((k) => {
              const zvoleno = vybrane.has(k.title)
              return (
                <li key={k.title}>
                  <button
                    onClick={() => prepni(k.title)}
                    aria-pressed={zvoleno}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left"
                  >
                    <span
                      aria-hidden="true"
                      // Fajfka v akcentu, ne modrá plocha: tři vyplněné
                      // čtverce vedle modrého „Přidat" byly na panelu to
                      // nejhlasitější, a přitom je to výchozí stav.
                      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${
                        zvoleno ? 'border-accent text-accent-deep' : 'border-edge text-transparent'
                      } ${klid ? '' : 'transition-colors duration-150'}`}
                    >
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12.5l5 5 9-10" />
                      </svg>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] leading-snug text-ink">{k.title}</span>
                      <span className="mt-0.5 block text-[13px] leading-snug text-ink-soft">{k.duvod}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          <Button disabled={vybrane.size === 0 || uklada} onClick={() => void pridat()}>
            Přidat · {vybrane.size}
          </Button>
        </div>
      </DisclosureContent>
    </section>
  )
}

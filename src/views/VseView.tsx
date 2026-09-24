// „Vše" — druhá odpověď záložky Dnes.
//
// Dnes odpovídá na „co teď?" a schválně ukazuje jen dnešek. Jenže občas
// je otázka jiná: „kde je ten úkol?" nebo „co všechno mám rozdělané?".
// Na to byla appka slepá — Plán se dívá dopředu po dnech, inbox je jen
// „bez termínu" a hledání chce vědět, co hledáš. Chybělo místo, kde je
// vidět VŠECHNO otevřené najednou.
//
// Proto to není nová záložka: dok má tři sloty a čtvrtý by rozbil
// soustřednou kapsli i „jedna obrazovka = jedna odpověď". Je to DRUHÁ
// POLOHA téže záložky — dvojité ťuknutí na Dnes. Jedno ťuknutí = dnešek
// (nic se nemění), dvojité = vše.
//
// Ukazuje jen OTEVŘENÉ úkoly (inbox + aktivní). Hotové jsou historie,
// patří do týdenního ohlédnutí a do sbalené sekce na Dnes; kdyby se
// přisypaly sem, byl by z „vše" archiv a číslo v hlavičce by lhalo o tom,
// kolik práce zbývá. Podtitulek to říká nahlas, ne mezi řádky.

import { Fragment, useCallback, useState, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { jeMuj, kdoMa, mojeUkoly, skupinyLidi } from '../lib/tymUkoly'
import { useJa, useLide, useSdilim } from '../lib/useTym'
import type { Task } from '../db/types'
import { allClients, allProjects, completeTask, openTasks, reopenTask, sortTasks } from '../db/repo'
import { todayISO } from '../lib/dates'
import { plural } from '../lib/labels'
import { jePropadly, popisPropadlych } from '../lib/vseUkoly'
import { Chip } from '../components/Chip'
import { TaskRow } from '../components/TaskRow'
import { TriageSheet } from '../components/TriageSheet'
import { AnimatedBackground } from '../components/ui/AnimatedBackground'
import { TextEffect } from '../components/ui/TextEffect'

// Kaskáda nástupu sekcí (proměnnou čte animace .rise v index.css).
const stagger = (i: number) => ({ '--stagger': i }) as React.CSSProperties

// Po kolika řádcích se seznam dobírá. Stejná dávka jako na Dnes —
// tři sta řádků najednou je zeď a pomalý telefon to odnese.
const DAVKA = 30

// Řazení: jeden seznam podle priority (výchozí — viz `lib/vseUkoly.ts`),
// nebo po klientech — jeden klient v kuse, míň přepínání kontextu.
// „kdo" se nabízí jen tomu, kdo něco sdílí — jinak by to byl přepínač
// s jedinou skupinou („Já"), tedy tlačítko, které nic nedělá.
type Razeni = 'priorita' | 'klient' | 'kdo'
const RAZENI_KLIC = 'todo.vse.razeni'

interface Skupina {
  klic: string
  jmeno: string
  barva?: string
  ukoly: Task[]
}

export function VseView({
  onOpenTask,
  onZpet,
}: {
  onOpenTask: (t: Task) => void
  onZpet: () => void
}) {
  const dnes = todayISO()
  const [razeni, setRazeni] = useState<Razeni>(() => {
    // Cokoli jiného (i staré uložené 'termin') padá na prioritu — neznámá
    // volba je výchozí stav, ne prázdná obrazovka.
    const ulozene = localStorage.getItem(RAZENI_KLIC)
    return ulozene === 'klient' || ulozene === 'kdo' ? ulozene : 'priorita'
  })
  const zmenRazeni = (r: Razeni) => {
    localStorage.setItem(RAZENI_KLIC, r)
    setRazeni(r)
  }
  const [limit, setLimit] = useState(DAVKA)
  const [triageOpen, setTriageOpen] = useState(false)

  // `undefined` znamená „ještě nevím", ne „nic tu není" — stejně jako na
  // Dnes. Prázdný stav se smí ukázat teprve po prvním doběhnutém dotazu.
  const openRaw = useLiveQuery(openTasks, [])
  const nacteno = openRaw !== undefined
  const open = openRaw ?? []
  const clients = useLiveQuery(allClients, []) ?? []
  const projects = useLiveQuery(allProjects, []) ?? []
  const clientMap = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients])
  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  // Vše ukazuje i práci kolegů — schválně. Dnes a Plán odpovídají na
  // „co mám dělat já", tahle obrazovka na „kde je ten úkol" a „co všechno
  // se u nás děje"; kdyby cizí úkoly schovala, nebylo by je kde najít.
  // Čí co je, říká jméno u řádku.
  const ja = useJa()
  const lide = useLide()
  const sdilim = useSdilim()
  // Uložená volba přežije i zrušení sdílení — pak by zůstal přepínač
  // ve stavu, který se nemá kde přepnout zpátky.
  const razeniPlatne: Razeni = razeni === 'kdo' && !sdilim ? 'priorita' : razeni

  // Triáž posouvá termíny, takže do fronty patří jen MOJE propadlé:
  // přeložit kolegovi termín z mojí obrazovky je zásah do jeho práce.
  const propadle = useMemo(
    () => sortTasks(mojeUkoly(open.filter((t) => jePropadly(t, dnes)), ja)),
    [open, dnes, ja],
  )
  // Táž řádka jako na Dnes, tedy i totéž jméno a tón: „po termínu" jen
  // když nějaký termín opravdu propadl (`src/lib/vseUkoly.ts`).
  const popis = useMemo(() => popisPropadlych(propadle, dnes), [propadle, dnes])

  const skupiny: Skupina[] = useMemo(
    () =>
      razeniPlatne === 'kdo'
      ? skupinyLidi(open, ja, lide).map((s) => ({
          klic: s.klic,
          jmeno: s.nazev,
          ukoly: sortTasks(s.ukoly),
        }))
      : razeniPlatne === 'klient'
      ? (() => {
          const map = new Map<string, Task[]>()
          for (const t of open) {
            const k = t.clientId && clientMap.has(t.clientId) ? t.clientId : ''
            const uz = map.get(k)
            if (uz) uz.push(t)
            else map.set(k, [t])
          }
          return [...map.entries()]
            .sort((a, b) => {
              // „bez klienta" na konec — je to zbytek, ne klient.
              if (!a[0]) return 1
              if (!b[0]) return -1
              return clientMap.get(a[0])!.name.localeCompare(clientMap.get(b[0])!.name, 'cs')
            })
            .map(([id, ukoly]) => ({
              klic: id || 'bez',
              jmeno: id ? clientMap.get(id)!.name : 'bez klienta',
              barva: id ? clientMap.get(id)!.color : undefined,
              ukoly: sortTasks(ukoly),
            }))
        })()
      : // Jeden seznam odshora dolů. Skupina je tu jen obal, ze kterého se
        // dál počítá strop a dobírání — hlavičku nedostane (níž).
        [{ klic: 'vse', jmeno: '', ukoly: sortTasks(open) }],
    [razeniPlatne, open, clientMap, ja, lide],
  )

  // Strop platí na CELÝ seznam, ne na každou skupinu zvlášť — jinak by
  // šest košů po třiceti řádcích bylo sto osmdesát řádků místo třiceti.
  let zbylo = limit
  const viditelne = skupiny
    .map((s) => {
      const cast = s.ukoly.slice(0, Math.max(0, zbylo))
      zbylo -= cast.length
      return { ...s, ukoly: cast }
    })
    .filter((s) => s.ukoly.length > 0)
  const zbyva = open.length - Math.min(open.length, limit)

  // Stabilní identita kvůli `memo` na `TaskRow` — nová funkce při každém
  // překreslení by memoizaci zrušila a řádky by se překreslily všechny.
  const toggle = useCallback((t: Task) => {
    void (t.status === 'done' ? reopenTask(t.id) : completeTask(t.id))
  }, [])

  // Ve skupinách po lidech nese jméno hlavička, takže by u každého řádku
  // stálo podruhé — pod nadpisem „jana" je řádka „jana" jen šum.
  const kdoJmeno = (t: Task): string | undefined => {
    if (razeniPlatne === 'kdo' || jeMuj(t, ja)) return undefined
    return lide.get(kdoMa(t, ja) ?? '') ?? 'někdo další'
  }

  const row = (t: Task) => (
    <TaskRow
      key={t.id}
      task={t}
      client={t.clientId ? clientMap.get(t.clientId) : undefined}
      project={t.projectId ? projectMap.get(t.projectId) : undefined}
      onToggle={toggle}
      onOpen={onOpenTask}
      showDate
      kdoMaJmeno={kdoJmeno(t)}
    />
  )

  return (
    <div className="space-y-5">
      <header className="rise">
        <TextEffect as="h1" per="char" preset="blur" className="display text-[2.1rem] font-semibold leading-tight">
          Vše
        </TextEffect>
        <p className="mt-1.5 text-[13px] text-ink-soft">
          {open.length} {plural(open.length, 'otevřený úkol', 'otevřené úkoly', 'otevřených úkolů')} ·{' '}
          {sdilim ? 'i práce kolegů' : 'napříč dny i klienty'}
        </p>
      </header>

      {/* Cesta zpátky je vidět. Dvojité ťuknutí na Dnes vrátí totéž, ale
          na skryté gesto se nikdo nespoléhá — kdo sem spadl omylem, musí
          ven bez hádání. */}
      <div className="radka-mizi rise -mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1" style={{ scrollbarWidth: 'none', ...stagger(1) }}>
        {/* Vlastní aria-label: viditelné „Dnes" je v něm obsažené (WCAG
            label-in-name), ale pro čtečku i pro testy je řádka doku
            jednoznačná — jinak jsou v dokumentu dvě tlačítka „Dnes". */}
        <Chip onClick={onZpet} aria-label="Zpět na Dnes">
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-ink-soft" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 6l-6 6 6 6" />
          </svg>
          Dnes
        </Chip>
        {open.length > 0 && (
          <div className="ml-auto flex shrink-0 gap-0.5 rounded-full bg-well p-0.5">
            {/* AnimatedBackground (motion-primitives): pilulka mezi volbami plyne */}
            <AnimatedBackground value={razeniPlatne} onValueChange={(id) => zmenRazeni(id as Razeni)} className="rounded-full bg-card shadow-card">
              {[
                <button key="priorita" data-id="priorita" className="h-8 rounded-full px-2.5 text-[12px] font-medium text-ink-soft data-[checked=true]:text-ink">
                  Priorita
                </button>,
                <button key="klient" data-id="klient" className="h-8 rounded-full px-2.5 text-[12px] font-medium text-ink-soft data-[checked=true]:text-ink">
                  Klient
                </button>,
                ...(sdilim
                  ? [
                      <button key="kdo" data-id="kdo" className="h-8 rounded-full px-2.5 text-[12px] font-medium text-ink-soft data-[checked=true]:text-ink">
                        Kdo
                      </button>,
                    ]
                  : []),
              ]}
            </AnimatedBackground>
          </div>
        )}
      </div>

      <section className="rise" style={stagger(2)}>
        {open.length > 0 ? (
          <div className="seznam-na-papire">
            {popis && (
              // Táž řádka triáže jako na Dnes: kde jsou propadlé vidět,
              // tam musí být i cesta ven po jednom.
              <button
                onClick={() => setTriageOpen(true)}
                className="flex w-full items-center justify-between gap-2 border-b border-line px-4 py-2.5 text-left transition-colors duration-150 active:bg-well/60"
              >
                <span
                  className={`text-[13px] font-medium first-letter:uppercase ${
                    popis.tone === 'danger' ? 'text-danger' : 'text-note-ink'
                  }`}
                >
                  {popis.slovo} · {popis.pocet}
                </span>
                <span className="flex shrink-0 items-center gap-1 text-[13px] font-medium text-accent-deep">
                  Projít
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </span>
              </button>
            )}

            <ul className="divide-y divide-line">
              {viditelne.map((s) => (
                <Fragment key={s.klic}>
                  {/* Seznam podle priority je JEDEN, takže nadpis nemá co
                      pojmenovat — hlavičku dostávají jen skupiny (klient,
                      kdo). */}
                  {razeniPlatne !== 'priorita' && (
                    <li className="skupina-li">
                      <span className="flex items-center gap-1.5 px-4 pb-1 pt-3 text-[12px] font-medium text-ink-soft first-letter:uppercase">
                        {razeniPlatne === 'klient' && (
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.barva ?? 'var(--color-edge)' }} />
                        )}
                        {s.jmeno} · {s.ukoly.length}
                      </span>
                    </li>
                  )}
                  {s.ukoly.map(row)}
                </Fragment>
              ))}
            </ul>

            {zbyva > 0 && (
              <button
                onClick={() => setLimit((l) => l + DAVKA)}
                className="w-full border-t border-line py-2.5 text-center text-sm font-medium text-accent-deep transition-colors duration-150 active:bg-well/60"
              >
                {`Zobrazit ${Math.min(zbyva, DAVKA)} ${plural(Math.min(zbyva, DAVKA), 'další', 'další', 'dalších')}`}
                {zbyva > DAVKA && ` (zbývá ${zbyva})`}
              </button>
            )}
          </div>
        ) : (
          nacteno && (
            <div className="rounded-2xl bg-card px-5 py-8 text-center shadow-card">
              <p className="display text-lg font-medium">Nic otevřeného</p>
              <p className="mt-1 text-sm text-ink-soft">Všechno je hotové nebo zavřené.</p>
            </div>
          )
        )}
      </section>

      {triageOpen && <TriageSheet ukoly={propadle} clients={clientMap} nadpis={popis?.slovo} onClose={() => setTriageOpen(false)} />}
    </div>
  )
}

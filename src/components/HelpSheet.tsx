import { Sheet } from './Sheet'

// Nápověda: appka umí spoustu věcí gestem nebo psaním, ale nic z toho
// není vidět. Tohle je jediné místo, kde se to dá přečíst — otevírá se
// z prázdného stavu na Dnes a ze Synchronizace.

const SYNTAX: Array<{ example: string; means: string }> = [
  { example: 'zítra poslat report', means: 'termín na zítřek' },
  { example: 'v pátek fakturace', means: 'nejbližší pátek' },
  { example: '15.9. návrh webu', means: 'konkrétní datum' },
  { example: 'zavolat Pepovi do 14:00', means: 'termín i s časem' },
  { example: 'report @klient', means: 'přiřadí klienta' },
  { example: 'bannery #kampaň', means: 'přiřadí projekt' },
  { example: 'zaplatit fakturu !!', means: 'vysoká priorita (!!! kritická)' },
  { example: 'každý pátek report', means: 'opakující se úkol' },
  { example: 'schůzka // vzít podklady', means: 'poznámka za dvěma lomítky' },
]

const GESTURES: Array<{ what: string; how: string }> = [
  { what: 'Přejeď úkol doprava', how: 'označí ho jako hotový' },
  { what: 'Přejeď úkol doleva', how: 'odloží na zítřek nebo vybere termín' },
  { what: 'Ťukni na úkol', how: 'otevře detail — podúkoly, poznámky, opakování' },
  { what: 'Ťukni na jméno klienta nebo projektu', how: 'přejmenuje ho' },
  { what: 'Připnout v detailu úkolu', how: 'dá úkol mezi Top 3 dne' },
]

const NOTIFICATIONS: Array<{ when: string; what: string }> = [
  { when: 'Ráno v 7:00', what: 'Návrh dne — co dnes dává smysl vzít první' },
  { when: '15 minut předem', what: 'Připomínka úkolu, kterému jsi dal čas („do 14:00")' },
  { when: 'V 11:00 a 15:00', what: 'Pobídka s nejdůležitějším úkolem, který ještě zbývá' },
  { when: 'Všední den v 17:30', what: 'Uzávěrka dne, když ještě něco zbývá' },
  { when: 'Neděle v 18:00', what: 'Ohlédnutí za týdnem' },
]

const AUTOMATIC: string[] = [
  'Ráno spočítá návrh dne a pošle upozornění (jde zapnout v Synchronizaci).',
  'Hlídá klienty, na které se dlouho nesáhlo, a projekty bez dalšího kroku.',
  'Po 16. hodině nabídne uzávěrku dne — zbylé úkoly dostanou nový termín.',
  'V neděli a v pondělí nabídne ohlédnutí za týdnem.',
  'Schůzky z Google kalendáře se ukazují na Dnes i v Plánu.',
  'Úkoly ze sdílených projektů v Todoistu chodí ke svým klientům; co tady odškrtnu, je hotové i tam.',
]

export function HelpSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet onClose={onClose} tone="paper" className="space-y-5">
      {() => (
        <>
          <header className="pt-1">
            <h2 className="display text-2xl font-bold">Jak to funguje</h2>
            <p className="mt-1 text-sm text-ink-soft">
              Úkol stačí napsat běžnou větou — appka si z ní vezme termín, klienta i prioritu.
            </p>
          </header>

          <section>
            <h3 className="section-label mb-2">psaní úkolů</h3>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">
              {SYNTAX.map((s) => (
                <li key={s.example} className="px-4 py-2.5">
                  <span className="block text-[15px] text-ink">„{s.example}"</span>
                  <span className="text-[13px] text-ink-soft">{s.means}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="section-label mb-2">gesta a ťuknutí</h3>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">
              {GESTURES.map((g) => (
                <li key={g.what} className="px-4 py-2.5">
                  <span className="block text-[15px] text-ink">{g.what}</span>
                  <span className="text-[13px] text-ink-soft">{g.how}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="section-label mb-2">kdy se ozve</h3>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">
              {NOTIFICATIONS.map((n) => (
                <li key={n.when} className="px-4 py-2.5">
                  <span className="block text-[15px] text-ink">{n.when}</span>
                  <span className="text-[13px] text-ink-soft">{n.what}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 px-1 text-[12px] text-ink-faint">
              Upozornění se zapínají v Synchronizaci. Když se zrovna díváš do appky,
              nepřijdou — jen se srovná číslo na ikoně.
            </p>
          </section>

          <section>
            <h3 className="section-label mb-2">co appka dělá sama</h3>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">
              {AUTOMATIC.map((a) => (
                <li key={a} className="px-4 py-2.5 text-[14px] text-ink-soft">
                  {a}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </Sheet>
  )
}

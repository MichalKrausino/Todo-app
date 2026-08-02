# Todo-app — chytrý todo + kalendář

Osobní PWA pro marketéra, který řídí práci pro více klientů. Kompletní plán,
zdůvodnění rozhodnutí a roadmapa fází: **`docs/PLAN.md`** — před většími zásahy si ho přečti.

## Příkazy

- `npm run dev` — vývojový server
- `npm run build` — typecheck (`tsc`) + produkční build
- `npm test` — vitest (hlavně parser rychlého zadávání)
- `npm run typecheck` — jen typecheck

## Architektonická pravidla (neporušovat)

1. **Offline-first.** Zdrojem pravdy je IndexedDB (Dexie, `src/db/db.ts`). UI čte a
   zapisuje výhradně přes vrstvu `src/db/repo.ts` a nikdy nečeká na síť.
   Komponenty nikdy nevolají síť přímo — síť smí jen synchronizační vrstva
   `src/sync/` (engine), která běží na pozadí: pull → push, konflikty LWW podle
   `updatedAt` (server má stejný guard jako trigger, viz `supabase/schema.sql`).
   Repo hlásí zápisy přes `src/db/events.ts`, engine na ně reaguje debounced
   pushem. UI čte stav syncu jen přes `src/sync/status.ts`.
2. **Tombstony.** Záznamy se nikdy nemažou natvrdo — nastavuje se `deletedAt`.
   Všechny dotazy musí filtrovat `deletedAt`. Konflikty při synchronizaci řeší
   last-write-wins podle `updatedAt`.
3. **Timestampy.** Každý zápis přes repo vrstvu razítkuje `updatedAt` (ISO datetime).
   Denní data (`dueDate`, `scheduledFor`) jsou lokální `YYYY-MM-DD` přes
   `src/lib/dates.ts` — nikdy `toISOString()`, uteklo by to kolem půlnoci do UTC.
4. **Kalendář (Fáze 3).** Čteme všechny kalendáře uživatele, ale zapisujeme JEN do
   vlastního kalendáře „Todo“. Google refresh tokeny patří na server (Supabase),
   nikdy do prohlížeče.
5. **AI (Fáze 5+).** Volání modelu jen přes Supabase Edge Function, API klíč nikdy
   v prohlížeči. Ranní návrh dne počítá server — iOS nedává webovým appkám běh na
   pozadí. `estimateMinutes` je tichý odhad, nikdy se nezobrazuje jako pole k vyplnění.
6. **UI česky.** Veškeré texty v rozhraní jsou české.

## Design („papírový diář“)

Tokeny v `src/index.css` (Tailwind v4 `@theme`) — **používat výhradně je**,
žádné surové Tailwind barvy (slate/indigo/…): `paper` (pozadí), `card`
(plochy), `well` (zapuštěné), `line` (linky), `ink`/`ink-soft`/`ink-faint`
(text), jediný akcent `accent` (terakota) + `accent-deep`/`accent-wash`,
sémantické `danger`, `note`/`note-ink` (signály), `moss` (ok). Stíny jen
tónované (`shadow-card`, `shadow-sheet`, `shadow-float`). Nadpisy třídou
`display` (Fraunces), štítky sekcí `section-label` (serif italic, ne
verzálky). Písma self-hostovaná přes @fontsource (offline!). Animace:
`rise` (nástup karet, zpoždění dle indexu), `pop` (fajfka), `sheet-*`
(panely) — respektují `prefers-reduced-motion`. Ikony PWA generuje
skript v terakotě — při změně barev přegenerovat.

## Datový model

`src/db/types.ts`: Client (zároveň oblast: `client | internal | personal`) →
Project → Task; Template (balíčky pravidelných úkolů, Fáze 4), DayPlan (ranní
návrhy a reakce na ně, Fáze 6). Úkol může viset přímo pod klientem bez projektu.

## Stav fází (roadmapa v docs/PLAN.md)

- [x] Fáze 1 — kostra: PWA na plochu, lokální DB, klienti/projekty/úkoly, rychlé zadávání s českým parserem (`src/lib/quickAdd.ts`), obrazovky Dnes/Plán/Klienti
- [x] Fáze 2 — dvě zařízení: Google login, Supabase schéma (`supabase/schema.sql`), sync s tombstony (`src/sync/`) — kód hotový; zbývá jednorázově založit Supabase projekt podle README a ověřit na dvou zařízeních
- [ ] Fáze 3 — Google Calendar: čtení volných oken, zápis bloků do kalendáře „Todo“
- [x] Fáze 4 — šablony (`src/db/templates.ts`), RRULE opakování (`src/lib/rrule.ts`, knihovna rrule), hlídání zanedbaných klientů. Instance šablon mají deterministická id (`src/lib/deterministicId.ts`) — obě zařízení generují totéž, sync nevyrábí duplikáty a tombstone smazané instance vyhrává. Pravidla šablon s INTERVAL>1 se kotví k `RULE_EPOCH`. Samostatný opakující se úkol se po dokončení sám založí na další termín (respawn v `completeTask`). Reconciler běží při startu, při návratu do popředí a po doběhnutí syncu; generuje 30 dní dopředu.
- [x] Fáze 4.5 — tiché signály (`src/lib/signals.ts`, čisté funkce): zanedbaní klienti, klienti bez naplánovaného úkolu, projekty bez dalšího kroku, ležáky v inboxu, opakovaně odkládané úkoly (`postponeCount` počítá `updateTask` při posunu termínu na později; respawn ho nuluje). Zobrazuje blok „Nepropadá ti něco?" na Dnes (`SignalsBlock`), řádky navigují na klienta/úkol/inbox. Ranní návrh dne (Fáze 6) má z těchto signálů čerpat.
- [ ] Fáze 5 — AI: tiché odhady času, rozpad projektů, chytřejší parsování
- [ ] Fáze 6 — push notifikace + ranní návrh dne (pg_cron)
- [ ] Fáze 7 — týdenní zpětná vazba

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

## Design („tichý minimalismus“)

Nativní chování Apple aplikace, ale vlastní vzhled — inspirace Things 3
(vzdušnost, typografie místo rámečků) a Linear (kázeň, jemné obrysy místo
stínů). Systémový font (na iPhonu SF Pro — nic se nestahuje), seskupené
karty (`divide-y divide-line` v `rounded-2xl bg-card`) na **teplém**
podkladu `paper` (ne studená iOS šeď), hairline oddělovače, frosted-glass
tab bar, velké titulky (`display`), hlavičky sekcí `section-label` —
**tiché, ne verzálky**: velké písmeno dělá `::first-letter`, takže texty
v kódu zůstávají psané malými.

Hloubku dělá **ostrý hairline v `--shadow-card`**, ne rozmazaný stín.
Tokeny v `src/index.css` (Tailwind v4 `@theme`) — **používat výhradně je**,
žádné surové Tailwind barvy: `paper`/`card`/`well`/`line`, text
`ink`/`ink-soft`/`ink-faint`, jediný akcent `accent` (klidná modrá
`#3a6df0`, ne systémová iOS) + `accent-deep`/`accent-wash`, sémantické
`danger`, `note`/`note-ink` (signály), `amber`, `moss` (ok).

**Plný tmavý režim**: tokeny se přepisují v `@media (prefers-color-scheme:
dark)` — nová barva se VŽDY přidává v obou režimech; podklad je teplá
téměř-čerň (`#0e0e11`), ne plná čerň. Theme-color metas v `index.html`
jsou dvě (light/dark) a musí sedět s `paper`. Barvy klientů zůstávají
systémová paleta iOS (`CLIENT_COLORS`) — jsou to štítky, ne brand.
Animace `rise`/`pop`/`sheet-*` respektují `prefers-reduced-motion`.
Ikony PWA jsou v akcentní modré — **při změně akcentu přegenerovat**
(SVG v `public/favicon.svg` je předloha, PNG se renderují z něj).

## Datový model

`src/db/types.ts`: Client (zároveň oblast: `client | internal | personal`) →
Project → Task; Template (balíčky pravidelných úkolů, Fáze 4), DayPlan (ranní
návrhy a reakce na ně, Fáze 6). Úkol může viset přímo pod klientem bez projektu.
Pravidelná připomínka kontroly klienta = opakující se úkol s markerem
`isClientCheck` (`src/db/clientCheck.ts`), marker přežívá respawn.

## Stav fází (roadmapa v docs/PLAN.md)

- [x] Fáze 1 — kostra: PWA na plochu, lokální DB, klienti/projekty/úkoly, rychlé zadávání s českým parserem (`src/lib/quickAdd.ts`), obrazovky Dnes/Plán/Klienti
- [x] Fáze 2 — dvě zařízení: Google login, Supabase schéma (`supabase/schema.sql`), sync s tombstony (`src/sync/`) — kód hotový; zbývá jednorázově založit Supabase projekt podle README a ověřit na dvou zařízeních
- [x] Fáze 3 — Google Calendar: edge funkce `calendar` (events/scheduleBlock/deleteBlock; tokeny v `public.google_tokens`, OAuth údaje v `public.google_oauth` — RLS bez policies, jen service role). Klientská vrstva `src/sync/calendar.ts` cachuje události do Dexie (`calendarEvents`, okno 14 dní), obnovuje po syncu a při návratu do popředí. Volná okna počítá `src/lib/freeSlot.ts` (server má kopii téže logiky — udržovat v souladu). Přijetí ranního návrhu zabere blok v kalendáři „Todo“ (délka = estimateMinutes ?? 60); zrušení naplánování/smazání úkolu blok uvolní. Follow-upy ze schůzek: plusko u schůzky na Dnes založí úkol „Follow-up: …“ na dnešek (`addMeetingFollowUp`, deterministické id — bez duplikátů, tombstone vyhrává).
- [x] Fáze 4 — šablony (`src/db/templates.ts`), RRULE opakování (`src/lib/rrule.ts`, knihovna rrule), hlídání zanedbaných klientů. Instance šablon mají deterministická id (`src/lib/deterministicId.ts`) — obě zařízení generují totéž, sync nevyrábí duplikáty a tombstone smazané instance vyhrává. Pravidla šablon s INTERVAL>1 se kotví k `RULE_EPOCH`. Samostatný opakující se úkol se po dokončení sám založí na další termín (respawn v `completeTask`). Reconciler běží při startu, při návratu do popředí a po doběhnutí syncu; generuje 30 dní dopředu.
- [x] Fáze 4.5 — tiché signály (`src/lib/signals.ts`, čisté funkce): zanedbaní klienti, klienti bez naplánovaného úkolu, projekty bez dalšího kroku, ležáky v inboxu, opakovaně odkládané úkoly (`postponeCount` počítá `updateTask` při posunu termínu na později; respawn ho nuluje). Zobrazuje blok „Nepropadá ti něco?" na Dnes (`SignalsBlock`), řádky navigují na klienta/úkol/inbox. Ranní návrh dne (Fáze 6) má z těchto signálů čerpat.
- [ ] Fáze 5 — AI: rozpad projektů a chytřejší parsování čekají na model (Claude úloha přes předplatné, ne API). Hotová první část: tiché odhady času heuristikou (`src/lib/estimate.ts`) — razítkuje je `addTask` i reconciler šablon do `estimateMinutes`, kalendářní blok tak má reálnější délku; odhad se nikde nezobrazuje
- [x] Fáze 6 — push notifikace + ranní návrh dne: pg_cron (5:00 UTC) → edge funkce `morning-plan` (skórování = čistá logika, česká odůvodnění; deterministické id DayPlanu) → upsert do `day_plans` + Web Push (`@negrel/webpush`, VAPID v `private.vapid_keys`, RPC `get_vapid_keys` jen pro service_role). Klient: vlastní SW (`src/sw.ts`, injectManifest) s push/notificationclick, přepínač „Ranní návrh dne" v SyncSheet (`enablePush` v engine), blok návrhů na Dnes s přijmout/zamítnout (`decideDayPlanSuggestion` — accept nastaví `scheduledFor`; rozhodnutí se syncují pro budoucí učení ve Fázi 5). Model zatím nezapojen — jen formulace šablonami.
- [x] Fáze 7 — týdenní zpětná vazba (`src/lib/weekReview.ts`, čisté funkce): nedělní/pondělní karta na Dnes otevírá `WeeklyReviewSheet` — hotové úkoly a rozpad podle klientů, plán vs. realita, nejodkládanější úkoly, tiší klienti, výhled na 7 dní. Porovnání odhadu a skutečnosti času přibude s Fází 5 (estimateMinutes). Až bude Fáze 6 (push), nedělní notifikace má vést sem.

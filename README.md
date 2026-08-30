# Chytrý Todo + kalendář

Osobní systém pro marketéra řídícího práci pro více klientů. Ví, kteří klienti
existují, jaké pravidelné kontroly u nich musí proběhnout, a (v dalších fázích)
kolik času reálně zbývá v Google kalendáři — a každé ráno navrhne pár konkrétních
věcí k udělání. Běží jako PWA nainstalovaná na ploše iPhonu i MacBooku, funguje
offline a data drží lokálně v IndexedDB.

Kompletní technický plán a roadmapa: [`docs/PLAN.md`](docs/PLAN.md).
Pravidla pro vývoj: [`CLAUDE.md`](CLAUDE.md).

## Spuštění

```bash
npm install
npm run dev
```

Na iPhonu pak v Safari: **Sdílet → Přidat na plochu** — bez toho nefunguje
instalace ani (v pozdější fázi) push notifikace.

## Co už umí

- Klienti/oblasti → projekty → úkoly, vše offline v IndexedDB (Dexie)
- Rychlé zadávání s českým parserem: „ve čtvrtek poslat report @klient !vysoká“,
  „za 3 dny“, „příští týden“, „15.9.“ — funguje i bez diakritiky
- Obrazovky **Dnes** (po termínu / dnes / hotovo), **Plán** (podle dnů + bez
  termínu) a **Klienti** (detail, projekty, archivace)
- Instalace na plochu, offline režim přes service worker
- Synchronizace mezi zařízeními přes Supabase (Google login, tombstony,
  last-write-wins) — vyžaduje jednorázové nastavení níže
- Šablony pravidelných úkolů („Správa PPC“ → týdenní kontrola, měsíční
  report…) nasaditelné na klienty; úkoly se generují 30 dní dopředu
- Opakování úkolů: „každý pátek report“, „každých 14 dní fakturace“ —
  po odškrtnutí se úkol sám založí na další termín
- Hlídání zanedbaných klientů: nastav u klienta „hlídat po X dnech“
  a appka tě upozorní, když se u něj dlouho nic nedělo
- Tiché signály na obrazovce Dnes („Nepropadá ti něco?“): klient bez
  naplánované práce, projekt bez dalšího kroku, úkoly ležící v inboxu,
  opakovaně odkládané úkoly — připomínky věcí, které sis nezapsal
- Týdenní ohlédnutí (neděle/pondělí na Dnes): kolik se stihlo a komu,
  plán vs. realita, co odkládáš, u koho byl tichý týden, výhled na 7 dní
- Pravidelná připomínka kontroly klienta (týdně / každé 2 týdny / měsíčně):
  úkol „Zkontrolovat klienta“ se po odškrtnutí sám vrací — zapíná se při
  vytváření klienta nebo v jeho detailu
- Ranní návrh dne: server každé ráno vybere 3–6 úkolů (termíny, priority,
  odklady, zanedbaní klienti), pošle push notifikaci a v appce se návrhy
  přijímají/zamítají jedním klepnutím. Zapíná se v panelu synchronizace
  (obláček) — na iPhonu musí být appka přidaná na ploše
- Google kalendář (po přihlášení přes Google): schůzky ze všech kalendářů
  na Dnes s výpočtem volného času, počty schůzek v Plánu, a přijatý ranní
  návrh si sám zabere blok v samostatném kalendáři „Todo“ — tvoje schůzky
  appka nikdy neupravuje

## Synchronizace (Fáze 2) — jednorázové nastavení

Appka funguje i bez tohohle — čistě lokálně. Pro propojení iPhonu s MacBookem:

1. Na [supabase.com](https://supabase.com) založ projekt (free tier stačí).
2. V **SQL Editoru** spusť obsah souboru [`supabase/schema.sql`](supabase/schema.sql)
   — vytvoří tabulky, RLS („každý vidí jen svá data“) a last-write-wins trigger.
3. Zapni Google přihlášení: **Authentication → Sign In / Up → Google**.
   Podle návodu Supabase vytvoř OAuth klienta v Google Cloud Console a vlož
   Client ID + Secret. Do Google OAuth klienta patří redirect URI, které ukazuje
   Supabase na téže stránce.
4. V **Authentication → URL Configuration** nastav Site URL na adresu nasazené
   appky (např. `https://neco.vercel.app`) a do Additional Redirect URLs přidej
   `http://localhost:5173` pro vývoj.
5. Z **Project Settings → API** zkopíruj URL a anon klíč do `.env.local`
   (vzor v `.env.example`). Při nasazení na Vercel nastav tytéž proměnné
   v projektu na Vercelu.

Pak se v appce objeví přihlášení přes ikonu obláčku vpravo nahoře. Sync běží
na pozadí: při startu, při návratu do appky, chvíli po každé změně a ručně
tlačítkem. Konflikty řeší poslední zápis podle `updatedAt`, mazání jsou
tombstony — viz `src/sync/`.

Přihlásit se jde e-mailem a heslem (funguje hned) nebo přes Google — ten
vyžaduje OAuth klienta v Google Cloud Console a přijde vhod až s Fází 3
(kalendář), kdy bude stejně potřeba.

## Todoist (Fáze 8) — jednorázové nastavení

Sdílené projekty, do kterých mě klienti přidali, se dají natáhnout do appky
jako klienti a jejich úkoly.

1. V **Supabase → SQL Editoru** spusť poslední sekci
   [`supabase/schema.sql`](supabase/schema.sql) („Fáze 8: Todoist").
2. V **Edge Functions** vytvoř funkci `todoist` z
   [`supabase/functions/todoist/index.ts`](supabase/functions/todoist/index.ts),
   `verify_jwt` nech zapnuté.
3. V Todoistu: **Nastavení → Integrace → Vývojář** → zkopíruj API token.
4. V appce: obláček vpravo nahoře → **Todoist** → vlož token → Propojit
   a u každého sdíleného projektu vyber klienta.

Token se ukládá jen na server (RLS bez policies, čte ho pouze edge funkce)
a do prohlížeče se nikdy nevrací. Podrobnosti a mapování polí v
[`docs/TODOIST.md`](docs/TODOIST.md).

## Nasazení

Každý push na hlavní větev automaticky projde testy a nasadí se přes GitHub
Actions na GitHub Pages (`.github/workflows/deploy.yml`):
**https://michalkrausino.github.io/Todo-app/** — vyžaduje veřejné repo
(GitHub Pages na privátním repu chce placený plán). Supabase URL a publishable
klíč jsou ve workflow záměrně natvrdo — jsou to veřejné hodnoty, končí v JS
bundlu tak jako tak; data chrání RLS.

## Stack

React + TypeScript + Vite + Tailwind, PWA přes `vite-plugin-pwa`, lokální data
Dexie.js (IndexedDB). V dalších fázích Supabase (sync, push, cron) a Google
Calendar API — viz plán.

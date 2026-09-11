# Chytrý Todo + kalendář

Osobní systém pro marketéra řídícího práci pro více klientů. Ví, kteří klienti
existují, jaké pravidelné kontroly u nich musí proběhnout, a (v dalších fázích)
kolik času reálně zbývá v Google kalendáři — a každé ráno navrhne pár konkrétních
věcí k udělání. Běží jako PWA nainstalovaná na ploše iPhonu i MacBooku, funguje
offline a data drží lokálně v IndexedDB.

Kompletní technický plán a roadmapa: [`docs/PLAN.md`](docs/PLAN.md).
Pravidla pro vývoj: [`CLAUDE.md`](CLAUDE.md).

## Čeká na tebe

- [ ] **Publikovat OAuth aplikaci v Google Cloud.** Kalendář přestal fungovat,
  protože Google zneplatnil uložený refresh token (`invalid_grant`). Typická
  příčina: OAuth consent screen je v režimu **Testing**, kde tokeny žijí sedm
  dní. [Google Cloud Console → OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent)
  → **Publish app**. Bez toho se to bude opakovat každý týden.
- [ ] **Propojit Google znovu** v appce (obláček vpravo nahoře → „Propojit
  Google znovu"). Nový refresh token se uloží sám.
- [ ] Smazat dočasnou edge funkci `calendar-diag` v Supabase → Edge Functions
  (je vyprázdněná, vrací jen 410, ale nemá tam co dělat).

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
- Obrazovky **Dnes** (po termínu / dnes / hotovo), **Plán** (kalendář
  a agenda vybraného dne) a **Klienti** (detail, projekty, archivace)
- Instalace na plochu, offline režim přes service worker
- Dnes je jedna odpověď: hlavička, jedna řádka kontextu (ranní návrh,
  nejbližší schůzka, uzávěrka, signály, bez termínu — každé chip a panel)
  a jeden seznam v jedné kartě: triáž propadlých nahoře, připnuté,
  propadlé, dnešní, hotovo sbalené dole. Přepínač Priorita / Klient
  seskupí seznam po klientech.
- Dnes bez zdi: propadlé ukážou pár řádků a zbytek řeší triáž, „bez
  termínu" a „hotovo" stojí sbalené do řádky s počtem (rozbalení si appka
  pamatuje)
- Seznam klientů jako přehled: u každého na jedné řádce, co hoří („2 po
  termínu"), jak dlouho je ticho a kdy je další práce
- Detail klienta je práce, ne nastavení: hlavička s touž stavovou řádkou,
  řádka chipů („Upravit" otevře panel nastavení — jméno, barva, druh,
  kontrola, hlídání, šablony, Todoist, sdílení, archivace, smazání), tiché
  pole pro nový úkol a jeden seznam v jedné kartě: úkoly bez projektu, pak
  projekty jako skupinové řádky (ťuknutí otevře panel projektu), hotovo
  sbalené dole
- Detail úkolu bez formuláře: název jako titulek, poznámka pod ním a jedna
  stavová řádka slotů (Termín, Klient, Projekt, Priorita, Opakování,
  Naplánovat) — stejná jako při zadávání v doku
- Opakování s frekvencí i dnem: „týdně v neděli", „každé 2 týdny po a čt",
  „měsíčně 15.", „ročně 14. 9." — termín se sám srovná na první výskyt
- Triáž propadlých: nadpis „po termínu" otevře průchod jeden po druhém —
  u každého dnes / příští týden / už neplatí, se „Zpět" na poslední krok
- Odkaz v úkolu jde otevřít ťuknutím: Canva, Drive nebo brief v poznámce
  (i v názvu) se ukáže jako ikonka na řádku a jako čip v detailu — bez
  opisování adresy
- Klávesnice na Macu: ⌘K hledá, N otevře zadávání, 1 · 2 · 3 přepínají
  záložky, ⌘↩ uloží detail, Esc zavře; při psaní se písmena berou jako
  písmena
- Vzhled po úklidu: karty bez obrysu na teplém papíře, oddělovače od
  textu, priorita tečkou, kroužek postupu v hlavičce Dnes, dny v Plánu
  jako řádky s pruhem času.
- Plán bez mřížky: každý den je řádek a čas je pruh v barvách klientů
  (šedá schůzky), takže týden čteš jako graf — kde je plno, kde volno,
  komu který den patří. Ťuknutí na den ho rozbalí na místě: schůzky,
  úkoly, pole „nový úkol na ten den" a výběr z úkolů bez termínu
  („Sem" pošle úkol na vybraný den, toast to umí vrátit). Řádky jdou
  od dneška bez konce — další se přiberou samy, jakmile doscrolluješ
  dolů; dělí je měsíce (jméno a objem měsíce) a uvnitř tiché týdny.
- Tekutý dok jako na iOS 26: pod vybranou ikonou je skleněná čočka.
  Ikona pod prstem se stlačí hned při dotyku, po puštění se čočka
  nadzvedne, překlouže k nové záložce (sklo při jízdě chytí světlo) a
  dosedne, až když se zastaví; nová ikona vyjede zespoda; když prst na
  doku zůstane a táhne, čočka jede s ním a puštění vybere nejbližší
  záložku; vybraná ikona zesílí a dokreslí se tahem, dok při startu
  vyjede zespoda, pruhy v Plánu narostou
- Pohyb z knihoven motion-primitives, magicui, react-bits a shadcn/ui
  (motor `motion`): titulky se skládají po písmenech, obrazovky
  nastupují z rozostření, hrany pod dokem a lištou se rozpouštějí
  postupným rozostřením, čísla dojíždějí pružinou, splněný den slaví
  konfety, ranní návrh obíhá světlo, dok na Macu zvětšuje ikony pod
  kurzorem a ukazuje zkratky v tooltipech, hledání je paleta s rychlými
  akcemi (⌘K).
- Mazání se neptá, ale jde vrátit — u doku se po smazání ukáže „Vrátit"
  (u klienta se vrátí i jeho projekty a úkoly)
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
  vytváření klienta nebo v jeho nastavení
- Ranní návrh dne: server každé ráno vybere 3–6 úkolů (termíny, priority,
  odklady, zanedbaní klienti), pošle push notifikaci a v appce se návrhy
  přijímají/zamítají jedním klepnutím. Návrh se učí z odpovědí: „Dnes
  ne" = zítra znovu (podruhé za dva týdny = pauza), „Volnější den"
  = pauza rovnou, co ignoruješ, ustoupí jiným. Odložení není
  zapomenutí: appka ukáže, kdy se úkol vrátí (panel návrhu, inbox,
  Plán), a pak ho tři rána nabídne přednostně. Kam se odkládá, volí
  appka podle zátěže: nejbližší pracovní den, kde máš nejmíň úkolů
  a schůzek — v návrhu i v triáži propadlých. Zapíná se v panelu
  synchronizace (obláček) — na iPhonu musí být appka přidaná na ploše
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

## Sdílení klienta s kolegou (Fáze 9) — jednorázové nastavení

Na jednom klientovi může dělat víc lidí. Sdílí se **klient jako celek** —
jeho projekty i úkoly. Kdo je uvnitř, vidí je ve své appce jako svoje:
přidá úkol a druhý ho má, odškrtne ho a druhý vidí hotovo.

1. V **Supabase → SQL Editoru** spusť [`supabase/shares.sql`](supabase/shares.sql).
2. Kolega se v appce zaregistruje e-mailem a heslem (obláček vpravo nahoře).
   Účet musí existovat dřív, než ho půjde přidat.
3. V appce: obláček vpravo nahoře → **Sdílení s kolegy** → vyber klienta →
   vlož e-mail → Sdílet. (Totéž jde i dole v detailu klienta.)

Co se sdílí a co ne:

| | sdílí se |
|---|---|
| Klient, jeho projekty a úkoly | ano |
| Úkol, u kterého kolegu odškrtneš | ne — viz níž |
| Úkoly bez klienta (inbox) | ne, zůstávají soukromé |
| Šablony, ranní návrh dne, kalendář, Todoist | ne, každý má svoje |

**Jednotlivý úkol jde ze sdílení vyjmout.** I u společného klienta se dělá
práce, do které kolegovi nic není. V detailu úkolu je sekce **„Kdo úkol
vidí"** — odškrtnutý člověk úkol nedostane vůbec, ani do svého zařízení.
Hlídá to pravidlo na serveru (`data->'hiddenFrom'`), ne filtr v appce, takže
se k němu nedá dostat ani obejitím appky. Kdo je odškrtnutý, na řádek
nedosáhne, a nemůže se tedy ani sám vrátit zpátky.

Sdílení může zrušit zakladatel klienta (odebere kohokoli), nebo přizvaný
sám za sebe (**Odejít**). Komu se sdílení vezme, tomu se klientova data
smažou z jeho zařízení — na serveru zůstávají nedotčená u zakladatele.

V seznamu klientů je u sdílených „· sdíleno“, ať je od pohledu poznat,
co je společná práce a co jen tvoje.

### Offline

Sdílení nic nemění na tom, že appka je offline-first. Kdo je bez signálu,
píše dál do svého zařízení a odesílá se to, jakmile je síť — v metru,
v letadle i s vybitou wifi.

- **Odesílá se podle verzí, ne podle času.** Appka si vede evidenci, co už
  na serveru je a v jaké verzi, a posílá všechno, co se od ní liší.
  Rozcházející se hodiny dvou telefonů tak nemají jak změnu ztratit.
- **Kdo upraví tentýž úkol,** vyhrává pozdější zápis (podle `updatedAt`).
  U odškrtávání a psaní poznámek to je to, co člověk čeká.
- **Záznam, který server odmítne,** nezastaví odesílání ostatních. Kolik
  jich bylo, ukazuje panel synchronizace — odmítnutá změna se nemá tvářit
  jako uložená.
- **Jednou za den se uklidí,** co lokálně leží, ale server už to nezná
  (typicky úkol, který majitel přesunul jinam). Nikdy se nezahazuje to,
  co ještě čeká na odeslání.

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

# Todo-app — chytrý todo + kalendář

Osobní PWA pro marketéra, který řídí práci pro více klientů. Kompletní plán,
zdůvodnění rozhodnutí a roadmapa fází: **`docs/PLAN.md`** — před většími zásahy si ho přečti.

## Příkazy

- `npm run dev` — vývojový server
- `npm run build` — typecheck (`tsc`) + produkční build
- `npm test` — vitest (hlavně parser rychlého zadávání)
- `npm run typecheck` — jen typecheck
- `npm run audit:ui` — proměří symetrii, hrany prvků nad sebou, velikost
  cílů pro prst, přístupné názvy polí a **kontrast textu** (WCAG AA) na
  všech obrazovkách i v panelech, ve světlém i tmavém režimu.
  **Odsazení, mezery i barvy posuzuj z něj, ne okem.** Šířku bere
  `--sirka=320` (iPhone SE) / `390` / `430` — na úzkém displeji se rozsype
  to, co na širokém projde, takže před commitem projeď aspoň 320 a 390.
  Barvy se čtou z plátna, ne z řetězce: Tailwind zapisuje průhlednost přes
  `color-mix()` a poloprůhledný text se měří podložený, tak jak ho oko vidí.
  Vodorovně scrollující řádky smí přetékat k okraji zápornou marží; audit
  u nich porovnává hranu obsahu. Řádkové (`display: inline`) boxy se
  neměří — jsou široké jako text, ne jako místo, které dostaly. Vědomé
  výjimky jsou v něm vyjmenované i s důvodem.
- `npm run audit:chovani` — co pravítkem nezměříš: klidový režim
  (`prefers-reduced-motion`) musí zastavit **všechno**, běžný režim naopak
  animovat, appka musí přežít proklikání (založení úkolu, odškrtnutí,
  přepnutí obrazovek, panely, uložení detailu, znovunačtení z IndexedDB)
  a panel se musí dát zavřít stažením **za úchyt nahoře** (prst se posílá
  přes CDP — rychlost tahu je součást gesta, švihnutí zavírá, pomalé
  lízmutí ne) a zároveň musí jít obsah panelu pořád rolovat prstem.
  Chce hotový `npm run build`.
- `npm run nahled` — obrázky appky do `.snimky/` (obě schémata, rozměr iPhonu).
  **Vzhled posuzuj z nich, ne odhadem.** Chromium bez GPU vykresluje
  `backdrop-filter` po dlaždicích — sklo doku by vyšlo rozmazané jen v pruhu
  uprostřed, proto skript vynucuje softwarový ANGLE/SwiftShader. Ten je ale
  pomalý, takže se před každým snímkem čeká na doběhnutí animací
  (`document.getAnimations()`), ne na stopky — jinak snímek chytne panel
  v půlce výjezdu a straší na něm druhá patička.

## Architektonická pravidla (neporušovat)

1. **Offline-first.** Zdrojem pravdy je IndexedDB (Dexie, `src/db/db.ts`). UI čte a
   zapisuje výhradně přes vrstvu `src/db/repo.ts` a nikdy nečeká na síť.
   Komponenty nikdy nevolají síť přímo — síť smí jen synchronizační vrstva
   `src/sync/` (engine), která běží na pozadí: pull → push, konflikty LWW podle
   `updatedAt` (server má stejný guard jako trigger, viz `supabase/schema.sql`).
   Repo hlásí zápisy přes `src/db/events.ts`, engine na ně reaguje debounced
   pushem. **Co odeslat, se pozná podle evidence odeslaných verzí
   (`pushState`, logika v `src/sync/outbox.ts`), NIKDY podle času** — časový
   kurzor tiše ztrácel změny, kdykoli se rozešly hodiny dvou zařízení. UI čte stav syncu jen přes `src/sync/status.ts`. O čerstvost se
   stará jeden plánovač `src/sync/live.ts` — tiká, dokud je appka v popředí
   a je signál (vlastní data po minutě, kalendář a Todoist po pěti), a při
   návratu signálu, přepnutí wifi ↔ data i po probuzení zařízení stáhne
   všechno hned. Na pozadí se netahá nic — od toho jsou push notifikace.
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
podkladu `paper` (ne studená iOS šeď), hairline oddělovače, plovoucí skleněný dok
(kapsle bez obrysu, samé ikony, vybraná má pod sebou neutrální pilulku).
**Dok je „tekutý"** (`src/components/DokZalozky.tsx`, vlastní práce po
vzoru tab baru iOS 26 — Liquid Glass, jak ho nosí GitHub i Instagram):
pod vybranou ikonou je **čočka** — široké sklo 64 × 44 světlejší než
deska, s ostrým světlem na horní hraně a měkkým stínem, takže stojí
nad dokem (`.tab-on`); při přepnutí letí jako **kapka**: čočka má dvě hrany s vlastní
pružinou, hrana ve směru jízdy vyrazí hned a zadní o 90 ms později
(`ZADNI_HRANA_MS`), takže se mezi záložkami natáhne do dlouhé kapsle a
na cíli se stáhne kolem ikony; k tomu se **zvedne (1 → 1,1 → 1),
rozsvítí (`data-leti`)** a podle rychlosti zploští, ikona pod sklem se
o pár pixelů přitáhne k čočce (lom, `DokZalozka`) a nadme se, vybraná
ikona zesílí tah (1,7 → 2,1). Průzkum, ze kterého kapka vzešla: tab bar
iOS 26 (kapsle, která mezi záložkami „teče"), Cubertova liquid tab bar
na Dribbble, expo-glass-tabs (interruptible spring na transformu). Když prst na doku zůstane a táhne, čočka se odlepí a jede
s ním — pružina za prstem lehce
zaostává, podle rychlosti se roztahuje do strany (želé: `useVelocity` →
`scaleX`, `scaleY` dorovnává objem), ikona, kolem které projíždí, se
nadme, a puštění vybere záložku nejblíž prstu. Podpis vybrané ikony
(fajfka, linka data, druhá postava) se dokreslí tahem (`motion.path`,
`pathLength`), ikona při vybrání poskočí pružinou a dok při startu
vyjede zespoda. Tři věci, které se tu dají rozbít: (1) gesto stojí na
pointer events + pointer capture na celém pásu s `touch-action: none`;
s capture pošle prohlížeč `click` pásu, ne tlačítku, takže **výběr dělá
pointerup**, `onClick` tlačítek zůstává pro klávesnici a je idempotentní;
(2) polohy ikon se měří při stisku a přes `ResizeObserver`, ne při
renderu — Dock z magicui je pod kurzorem zvětšuje a šířka pásu závisí
na klávesnici; **ResizeObserver se zakládá jednou** (aktuální záložka
z ref, první zavolání se přeskočí) — když visel na `value`, zakládal se
při každém přepnutí a jeho okamžité první zavolání čočku skočilo na
cíl dřív, než pružina vyrazila, takže let nebyl nikdy vidět (změřeno:
60 ms po ťuknutí už stála na místě; po opravě se natáhne z 64 na 213 px); (3) v klidovém režimu pilulka skáče bez pružiny (`jump`),
nic se neroztahuje ani nenadýmá.
Zadávání úkolu v doku má **jednu stavovou řádku** (Termín / Klient /
Projekt / Priorita — prázdný slot nabízí, vyplněný ukazuje hodnotu,
otevřený je plný akcent) a **jeden panel nad ní**, do kterého se vejdou
všechny výběry. V kalendáříku u zadávání je jediná plná výplň vybraný den, dnešek má
kroužek a vytížení dne je tečka pod číslem — dřív mělo „něco tam je"
i „tohle jsi zvolil" tutéž modrou a nešlo je rozeznat. Plán žádnou
mřížku nemá: dny jsou řádky a čas je pruh v barvách klientů — týden
jako vodorovný graf, který se rozbaluje na místě. Otevření termínu
schová klávesnici (a zavření ji vrátí): kalendář zmáčknutý do zbytku nad
klávesnicí je k nepřečtení, takhle dostane celou výšku a den je dost
velký na ťuknutí. Řádka se nikdy nezalamuje a panel má strop podle
viditelné výšky (`--vvh`), takže se pole nikdy neposune — jinak iOS
nechá kurzor viset mimo něj, velké titulky (`display`), hlavičky sekcí `section-label` —
**tiché, ne verzálky**: velké písmeno dělá `::first-letter`, takže texty
v kódu zůstávají psané malými.

**Žádné systémové dialogy.** `confirm()` ani `alert()` v appce nejsou:
na ploše iPhonu vyskočí systémový alert s adresou webu a rozbije dojem
nativní appky — a nic nechrání, protože kdo ho vidí pokaždé, odklepne ho
po očku. Mazání se proto nepotvrzuje, ale **jde vrátit**: záznam dostane
tombstone a u doku se ukáže „Vrátit" (`src/lib/toast.ts`, jeden toast pro
celou appku, jinak by se dvě zprávy překrývaly). Vrácení musí obnovit
celou kaskádu — klient bere s sebou projekty i úkoly — a razítkuje se
novým `updatedAt`, jinak by tombstone ze serveru podle LWW vyhrál a
záznam by se za chvíli smazal znovu. Ptát se smí jedině na to, co vrátit
nejde: smazání úkolu v Todoistu (zmizí i klientovi ve sdíleném projektu),
a i to se ptá **v panelu**, ne dialogem.

**Klávesnice na Macu** (`src/lib/shortcuts.ts`, čistá logika s testy):
⌘K / Ctrl K hledá i uprostřed psaní, jednopísmenné zkratky (N, /, 1–3)
jen mimo pole a bez modifikátorů, s otevřeným panelem
(`jeOtevrenyPanel()` ze `Sheet.tsx`) mlčí všechno — Escape patří panelu.
⌘↩ v detailu úkolu ukládá. Nápověda sekci zkratek ukazuje jen na
`(pointer: fine)`. **Odkazy** (`src/lib/links.ts`): URL z názvu i
poznámky je na řádku úkolu cíl k ťuknutí (první odkaz, `TaskRow`) a v
detailu čipy s doménou; tečka, čárka a závorka za adresou patří větě.

**Panel se chytá za úchyt, ne za plochu** (`Sheet.tsx` + `.sheet-grip`).
Tři věci, které se tu už dvakrát podařilo rozbít: (1) nájezd a sjezd dělá
**přechod, ne animace s `fill: both`** — animace v kaskádě přebíjí inline
styl, takže se panel prstem nehnul ani o pixel, i když se poloha poctivě
zapisovala; (2) gesto stojí na **pointer events a pointer capture**, ne na
`preventDefault` v touchmove — ten Safari od iOS 15 spolehlivě neposlouchá;
(3) úchyt je samostatný nerolující pruh s `touch-action: none`, protože na
rolovací ploše si prohlížeč vezme svislé gesto jako rolování a pošle
`pointercancel` po dvou pohybech (změřeno). Vzor: vaul od E. Kowalského.

**Karty nemají prstenec.** `--shadow-card` je jen dotek, který kartu
nenechá vypadat nalepenou; hloubku dělá kontrast papír × karta a jediný
opravdový stín má to, co plave (`--shadow-float`: plusko, toast). Dřív měl
obrys každý prvek — karty, kulatá tlačítka nahoře, dok — a když má obrys
všechno, nezvedá se nic. Stejně tak: oddělovače v seznamu úkolů vedou
**od textu, ne od kraje** (`.task-li` v `index.css`, rodič dál dává
`divide-y`), priorita je **tečka před názvem** (červená kritická, oranžová
vysoká; jméno zůstává pro čtečku), zaškrtávátko má 24 px a obrys `edge`,
hlavička Dnes je titulek + **jedna řádka** s kroužkem postupu (SVG, animuje
`stroke-dashoffset`), dny v Plánu jsou řádky s pruhem času na papíře, ne dlaždice v kartě,
primární akce mimo dok jsou tiché pilulky `well`, prázdné stavy prostý
text bez tečkovaného rámečku.

**Knihovny pohybu a prvků** (`src/components/ui/`, motor `motion` 13):
každá komponenta nese v hlavičce původ a je přepsaná do tokenů appky —
shadcn paleta (`bg-primary`, `text-muted-foreground`) se nepřebírá.
Z motion-primitives: `ProgressiveBlur` (závoj pod dokem a pod lištou,
šest vrstev s posunutou maskou — jedna vrstva je jen mléčný pruh),
`TextEffect` (titulky po písmenech), `AnimatedNumber` (počty pružinou),
`Magnetic` (plusko na Macu), `AnimatedBackground` (inkoustová pilulka
plyne mezi přepínači; pilulku pod záložkou doku dělá vlastní
`DokZalozky` s motion values, viz výš), `DisclosureContent` (sbalené sekce se rozbalují
na výšku). Z magicui: `Dock` (zvětšování ikon pod
kurzorem), `BlurFade` (nástup obrazovky ze strany, kam se v doku šlo),
`BorderBeam` (jen ranní návrh — jediná karta, kterou napsal server),
`Ripple` (prázdný stav), konfety přes `canvas-confetti` (splněný den,
jednou denně, `todo.konfety`). Z react-bits: `ClickSpark` (jiskry z místa
ťuknutí v doku), `BlurText` (nadpis prázdného stavu). Ze shadcn/ui nad
Radix a cmdk: `Button` (cva varianty: default akcent, secondary well,
ghost, destructive, link), `Switch`, `Tooltip` + `Kbd` (na Macu zkratky
u ikon), `Command` (hledání jako paleta s rychlými akcemi, filtr bez
diakritiky si dělá appka, `shouldFilter=false`). Čtyři věci, které se tu
dají rozbít: (1) **klidový režim** řeší `src/lib/motion.ts` — motion
v režimu `user` nechá běžet průhlednost a filtry a audit chování by je
napočítal jako běžící, komponenty proto v klidu kreslí rovnou konečný
stav; (2) po dojetí animace se **maže `filter`** — `blur(0px)` je pro
Chromium pořád filtr a box dostane o pixel širší přesah, obsah s `-mx-4`
pak přetekl (změřeno 391 > 390); (3) Dock reaguje jen na
`pointerType === 'mouse'` a Magnetic jen s `(hover: hover)` — Safari při
ťuknutí syntetizuje mousemove/mouseenter a ikona by zůstala nafouklá;
(4) `TextEffect` dává celý text do `aria-label`, ne do sr-only kopie —
textContent musí zůstat jeden kus, jinak testy čtou „DnesDnes";
(5) `DockIcon` má `transitionProperty: none` — velikost řídí pružina a
pojistka klidového režimu (`transition-duration: 0.01ms` na `*`) by
z každého zápisu šířky dělala běžící přechod; (6) vybraný chip klienta
dostane vlastní `bg-ink` se zpožděním 300 ms — audit kontrastu čte
podklad z předků, ne z létající pilulky, takže v klidu musí text stát
na pevné barvě. Signály „Nepropadá ti něco?" už na Dnes nejsou blok — jen
chip s počtem a panel (`SignalySheet`); oranžová plocha byla na
obrazovce s reálnými daty nejhlasitější prvek.
Tokeny v `src/index.css` (Tailwind v4 `@theme`) — **používat výhradně je**,
žádné surové Tailwind barvy: `paper`/`card`/`well`/`line`, text
`ink`/`ink-soft`/`ink-faint`, jediný akcent `accent` (klidná modrá
`#3a6df0`, ne systémová iOS) + `accent-deep`/`accent-wash`, sémantické
`danger`, `note`/`note-ink` (signály), `amber`, `moss` (ok).

**Akcent v textu je `accent-deep`, ne `accent`.** Samotný `accent` má na
papíře 4,2 : 1 — na výplň a ikonu (práh 3 : 1) to stačí, na písmo ne.
Ze stejného důvodu se **tichost nedělá průhledností**: `text-ink-faint/70`
vypadá jako jemný odstín, ale změřeně je to 2,8 : 1. Tón dělá token,
tichost velikost a váha písma. Prahy hlídá `npm run audit:ui` v obou
režimech — když se přidává barva nebo se s ní píše text, projeď ho.

**Plný tmavý režim**: řídí ho atribut `data-theme` na `<html>`, ne
`prefers-color-scheme` — v `index.css` není jediný takový dotaz. Volbu
(systém / světlý / tmavý) překládá `src/lib/theme.ts` a předběhne ji
skript v `index.html`, aby tmavá appka neproblikla bíle; volba je lokální
(localStorage), nesynchronizuje se. Tmavá paleta je díky tomu na jednom
místě — nová barva se přidává jen jednou. Podklad je teplá téměř-čerň
(`#0e0e11`), ne plná čerň. Jediná `theme-color` meta v `index.html` se
přepisuje z JS a musí sedět s `paper`. Barvy klientů zůstávají
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
- [x] Fáze 4 — šablony (`src/db/templates.ts`), RRULE opakování (`src/lib/rrule.ts`, knihovna rrule), hlídání zanedbaných klientů. Instance šablon mají deterministická id (`src/lib/deterministicId.ts`) — obě zařízení generují totéž, sync nevyrábí duplikáty a tombstone smazané instance vyhrává. Pravidla šablon s INTERVAL>1 se kotví k `RULE_EPOCH`. Samostatný opakující se úkol se po dokončení sám založí na další termín (respawn v `completeTask`). Reconciler běží při startu, při návratu do popředí a po doběhnutí syncu; generuje 90 dní dopředu (dřív 30 — Plán je od té doby nekonečný a čtvrt roku dopředu má vidět i pravidelné úkoly).
- [x] Fáze 4.5 — tiché signály (`src/lib/signals.ts`, čisté funkce): zanedbaní klienti, klienti bez naplánovaného úkolu, projekty bez dalšího kroku, ležáky v inboxu, opakovaně odkládané úkoly (`postponeCount` počítá `updateTask` při posunu termínu na později; respawn ho nuluje). Zobrazuje blok „Nepropadá ti něco?" na Dnes (`SignalsBlock`), řádky navigují na klienta/úkol/inbox. Ranní návrh dne (Fáze 6) má z těchto signálů čerpat.
- [ ] Fáze 5 — AI: rozpad projektů a chytřejší parsování čekají na model (Claude úloha přes předplatné, ne API). Hotová první část: tiché odhady času heuristikou (`src/lib/estimate.ts`) — razítkuje je `addTask` i reconciler šablon do `estimateMinutes`, kalendářní blok tak má reálnější délku; odhad se nikde nezobrazuje
- [x] Fáze 6 — push notifikace + ranní návrh dne: pg_cron (5:00 UTC) → edge funkce `morning-plan` (skórování a výběr = čistá logika v `supabase/functions/morning-plan/pick.ts`, testuje `pick.test.ts`; česká odůvodnění; deterministické id DayPlanu) → upsert do `day_plans` + Web Push (`@negrel/webpush`, VAPID v `private.vapid_keys`, RPC `get_vapid_keys` jen pro service_role). Klient: vlastní SW (`src/sw.ts`, injectManifest) s push/notificationclick, přepínač „Ranní návrh dne" v SyncSheet (`enablePush` v engine), blok návrhů na Dnes s přijmout/zamítnout (`decideDayPlanSuggestion` — accept nastaví `scheduledFor`; rozhodnutí se syncují pro budoucí učení ve Fázi 5). Model zatím nezapojen — jen formulace šablonami. **Úkoly bez termínu se nabízejí vždy**: mají vlastní základ skóre (jinak by s normální prioritou spadly na nulu a filtr `score > 0` by je vyhodil) a v návrhu rezervované sloty, aby je nabité dny s termíny nevytlačily. Jejich mix je vážený prioritou — klesající stropy `UNDATED_CAPS`, nevyčerpaná kapacita se dobere níž, takže bez kritických nabídku vyplní vysoké. Strop „nejvýš dva od jednoho klienta" platí jen na skutečné klienty; úkoly bez klienta spolu nesouvisí a nesdílejí ho. Zamítnutí úkol nikam neposouvá, takže se druhý den nabídne znovu — to je ono „odložit na zítra".
- [x] **Dnes = hlavička, jedna řádka kontextu, jeden seznam.** Obrazovka dřív skládala až jedenáct bloků pod sebe (návrh, kalendář, chipy, připnuté, po termínu, dnes, tip, bez termínu, hotovo, uzávěrka, signály) a na „co teď?" odpovídala jedenáctkrát. Teď: (1) hlavička s kroužkem postupu; (2) **kontextová řádka chipů** (`Chip` v `TodayView`) — ranní návrh („Návrh · 3", jediný s BorderBeamem, otevírá `NavrhSheet`: název, důvod, „Přijmout na dnešek" / „Dnes ne", „Přijmout zbývající", „Zpět" vrací na `ignored` a u přijatého i `scheduledFor` a blok v kalendáři), nejbližší schůzka („15:00 First Steps · za 2 h", otevírá `KalendarSheet` s celým dnem a volnými okny), uzávěrka (večer), signály („Signály · 6", otevírá `SignalySheet`), bez termínu (vede do Plánu) — nic z toho není dnešní práce, proto nic z toho není sekce; (3) **jeden seznam v jedné kartě**: řádka triáže „po termínu · N · Projít" nahoře, pak připnuté (špendlík na řádku), propadlé (červené datum na řádku), dnešní; „hotovo · N" sbalené na konci karty (`useRozbaleno`, rozbalení na výšku přes `DisclosureContent`); dobírá se po 30 řádcích. Přepínač **Priorita / Klient** (jen když dnes pracuješ pro víc klientů, `todo.dnes.razeni`) seskupí tentýž seznam po klientech — nahradil filtr chipů, který stál uprostřed obrazovky. Tip na gesta je jedna tichá věta pod kartou. Audit chování čte propadlé z řádky triáže (`/po termínu[^0-9]*(\d+)/i`) a hotovo z tlačítka `hotovo · N`.
- [x] Dnes bez zdi: obrazovka umí ukázat až jedenáct bloků a dohromady na „co teď?" neodpovídaly. Karta „Teď" se schválně nepřidává — připnuté a ranní návrh tou kartou už jsou, další blok by byl dvanáctý. Místo toho: propadlé ukážou napoprvé jen pět řádků (`DlouhySeznam` s `uvod`), zbytek patří do triáže, ne do zdi; „bez termínu" a „hotovo" stojí **sbalené** do řádky s počtem (`SbalenaSekce`), protože to není dnešní práce — číslo říká pravdu, rozbalení je na klepnutí a appka si ho pamatuje (`todo.dnes.rozbaleno`). Audit chování počítá s tím, že odškrtnutý úkol spadne do sbalené sekce, a ověřuje rozbalení i jeho přežití přes reload.
- [x] **Plán = dny jako řádky, čas jako pruh.** Jeden nápad, ne tři (`UpcomingView`): každý den je řádek — vlevo datum (zkratka dne, u dneška a zítřka „dnes"/„zítra" v `accent-deep`, číslo 22 px), vpravo **pruh**, jehož délka je naplánovaný čas (celý pruh = osm hodin: `plannedMinutes` úkolů + délka schůzek; přetečení stlačí díly na celý pruh a popisek řekne „přes 8 h") a **barvy jsou klienti**, šedá schůzka nebo úkol bez klienta; prázdný den má tichou kolej (`bg-well/60`) a „volno" — graf s nulou má pořád osu. Pod pruhem popisek „2 úkoly · 1 schůzka · ~3 h". Řádky jdou pod sebou od dneška (propadlé se počítají na dnešek — Plán se dívá dopředu, triáž je na Dnes), po týdnech se štítkem „tento týden / příští týden / od 21. září", 28 dní napoprvé a **bez konce dál**: jakmile se konec seznamu dostane na dohled (`IntersectionObserver`, 600 px před okrajem), přibere se další dávka 28 dní; tlačítko „Další čtyři týdny" pod ním zůstává pro klávesnici. Schůzky jsou v cache 180 dní dopředu (`FETCH_WINDOW_DAYS`), pravidelné úkoly ze šablon 90 dní (`GENERATION_HORIZON_DAYS`) — dál se ukážou jen úkoly s ručně zadaným termínem. **Žádný přepínač týden/měsíc, žádný pás čísel, žádná zvláštní karta**: ťuknutí na den ho rozbalí na místě (`DisclosureContent`): karta se schůzkami a úkoly (`DlouhySeznam` po 12), tiché pole „Nový úkol na sobotu 12. září…" (4. pád, `formatFullDateNa`; parser + `dueDate` = ten den, toast) a „+ Vybrat z úkolů bez termínu · N" — plánuje se tam, kde se den vidí. Díly pruhu narostou zleva (`.pruh-roste`, v klidu stojí). Dvě předchozí verze byly kalendář z telefonu (mřížka čísel s tečkami, pak se sloupky) a karta dne pod ním — mřížka umí říct jen „něco tam je" a u sedmi čísel v řádce není místo na jméno klienta ani na hodiny; řádek má celou šířku. Hlavička nese souhrn tohoto týdne, řádka chipů „Bez termínu · N" a „Týdenní ohlédnutí". **Bez termínu je panel** (`BezTerminuSheet`): z chipu jen k nahlédnutí, z rozbaleného dne jako výběr — „Sem" pošle úkol na ten den (`dueDate`, `status: 'active'`, toast se „Zpět" vrací do inboxu); fronta se snímá při otevření. Audit chování počítá `main li` v Plánu při 400 úkolech — řádky dnů plus agenda jednoho rozbaleného dne. Audit rozhraní hlídá, že rozbalený den stojí na hraně sekce, ne odsazený pod pruhem.
- [x] Jedno datum v detailu úkolu: primární je **Termín** (`dueDate` — to píše parser i rychlé zadávání, pro člověka je to „ten den"), `scheduledFor` je vrstva navrch (ranní návrh, uzávěrka) a v detailu se ukáže jen když je vyplněné nebo si o něj člověk řekne („+ Naplánovat na jiný den"). Data se nemění. Dřív stála dvě data vedle sebe a potřebovala odstavec, který vysvětluje rozdíl — když pole potřebuje odstavec, netrefil ho model, ne uživatel. Vysvětlení zůstalo jen u rozbaleného druhého data.
- [x] Klienti jako přehled stavu: řádek klienta nese jednu stavovou řádku v pořadí důležitosti — kolik hoří („2 po termínu", danger) → ticho („ticho 12 dní", note) → kdy je další práce (jen z toho, co teprve přijde; dřív se do „nejbližšího dne" započítal i propadlý termín a četlo se to jako plán) → druh → sdíleno. Pořadí je záměrné kvůli ořezu zprava na 320 px. Ticho bývalo samostatný odznak vpravo — tři prvky vedle sebe (odznak, počet, šipka) ořízly právě „po termínu".
- [x] **Detail klienta = hlavička, chipy, jeden seznam.** Obrazovka dřív skládala pod sebe napojení na Todoist, pole pro úkol, šablony, úkoly, každý projekt jako sekci s trvale viditelným „Uzavřít · Smazat", formulář projektu, hlídání, sdílení a mazání — nastavení mezi polem a seznamem, do kterého úkol padá. Teď: (1) hlavička s tečkou, jménem a **touž stavovou řádkou jako v seznamu** (`src/lib/clientStatus.ts`, čistá funkce `stavKlienta`); (2) řádka chipů (`Chip`): „Upravit" otevírá `KlientSheet` (jméno, barva, druh, pravidelná kontrola, hlídání zanedbání, šablony přepínači, Todoist, sdílení, archivace, smazání — vše se ukládá hned), ostatní chipy (Kontrola, Šablony · N, Todoist · N) jen říkají, co je zapnuté, a vedou tamtéž; (3) tiché pole pro nový úkol, plusko se vynoří až s textem; (4) **jeden seznam v jedné kartě**: úkoly bez projektu, pak každý projekt jako skupinová řádka (název, cíl, termín, „1 z 3", šipka) — ťuknutí otevře `ProjektSheet` (název, cíl, termín, uzavřít, smazat; obojí vratné toastem); „hotovo · N" sbalené na konci. Ze šablonových instancí je v detailu jen **nejbližší výskyt** každé položky — reconciler jich generuje na 90 dní dopředu a stejné řádky pod sebou byly šum (zbytek je v Plánu). Audit chování maže klienta přes „Upravit" → „Smazat klienta".
- [x] **Detail úkolu = titulek, poznámka, jedna stavová řádka.** Dřív formulář s osmi popsanými poli v rozbalovátkách; když pole potřebuje popisek a `<select>`, je to nastavení, ne úkol. Název je teď titulek (rostoucí `textarea`, Enter přeskočí do poznámky), poznámka pod ním bez rámečku, odkazy jako čipy, a všechno ostatní nese **stejná řádka slotů jako zadávání v doku** (`SlotChip`, sdílené v `src/components/SlotChip.tsx`): Termín (rychlé dny + `MonthPicker` + čas), Klient, Projekt, Priorita, Opakování, Naplánovat na jiný den. Panel s výběrem se rozbaluje pod řádkou; u úkolu z Todoistu slot Klient/Projekt jen řekne toastem, že zařazení patří Todoistu. **Opakování = frekvence + den**: pravidlo je explicitní (`RuleParts` v `src/lib/rrule.ts`: `partsFromRule`/`ruleFromParts`), u týdenních se volí dny v týdnu (i víc naráz), u měsíčních den v měsíci (mřížka 1–28), u ročních ještě měsíc. Dřív si předvolba brala den z termínu a „každou neděli" znamenalo napřed přesunout termín na neděli. Změna pravidla **srovná termín na první výskyt od dneška** (`alignDueDate`): stávající termín zůstane jen když pravidlo trefuje a ještě nenastal; bez termínu ho úkol dostane, protože respawn po odškrtnutí (`respawnRecurring`) se odvíjí od `dueDate`. Pravidlo mimo předvolby (z parseru, „každé 3 týdny") se nechá být a jen ukáže. Šablony (`RecurrencePicker`) stojí na týchž částech. Checklist je jedna karta s polem pro další krok uvnitř. Ukládá se tlačítkem a ⌘↩; checklist, špendlík a „kdo úkol vidí" hned. Audit chování plní `#pole-ukol` (teď `textarea`).
- [x] Triáž propadlých (`TriageSheet`): sekce „po termínu" umí narůst do stovek (změřeno 134 na roční hromádce) a jako seznam je to slepá ulička. Nadpis je proto akce — průchod po jednom se třemi odpověďmi (dnes / příští týden / už neplatí). Fronta se snímá při otevření, jinak by živý dotaz pod rukama přerovnával pořadí. Termín se posouvá stejně jako všude jinde (`scheduledFor`, a když ho úkol nemá, `dueDate`) — pevný termín se nikdy nepřepisuje potichu. „Už neplatí" nastaví `status: 'dropped'`, ne tombstone: úkol zmizí z otevřených seznamů, ale zahozená práce zůstane v datech. „Zpět" vrací i to.
- [x] Fáze 7 — týdenní zpětná vazba (`src/lib/weekReview.ts`, čisté funkce): nedělní/pondělní karta na Dnes otevírá `WeeklyReviewSheet` — hotové úkoly a rozpad podle klientů, plán vs. realita, nejodkládanější úkoly, tiší klienti, výhled na 7 dní. Porovnání odhadu a skutečnosti času přibude s Fází 5 (estimateMinutes). Až bude Fáze 6 (push), nedělní notifikace má vést sem.
- [x] Fáze 8 — Todoist: sdílené projekty klientů a jejich úkoly do appky. API token žije na serveru (`public.todoist_tokens`, RLS bez policies, write-only RPC `store_todoist_token`), do Todoistu sahá jen edge funkce `todoist` (projects/pull/close/reopen). Mapování polí je čistá logika (`src/lib/todoistMap.ts`), srovnání s lokální DB taky (`src/db/todoistImport.ts`) — projekt → klient (párování na `Client.todoistProjectIds`; za cizí se bere `is_shared || workspace_id`, jinak by týmové projekty nešly napojit), sekce → projekt, `deadline` → `dueDate`, `due` → `scheduledFor`, podúkoly → checklist (odškrtnutí kroku zavře podúkol i tam, nový krok tam vznikne, vlastní kroky stažení přežijí); lokální id deterministicky z todoistího. Todoist vlastní název, prioritu a termín; naplánování dne, odhad a špendlík zůstávají naše, poznámku a checklist si bere jen když je sám má. Zpátky letí odškrtnutí, znovuotevření, úpravy (`todoistDirty` = neodeslaná změna, stažení ji nepřepíše) a — po zapnutí u klienta (`todoistPushSince`) — i nové úkoly. Zamčené je jen zařazení. Opakovaný úkol se v Todoistu odškrtnutím posouvá, ne zavírá: nový termín se bere jako nový výskyt, hotový spadne do lokální historie (jinak by druhý `close` posunul úkol podruhé). Do appky chodí **jen úkoly, na kterých je uživatel označený**
  (`isMine`) — i z projektů, které nejsou spárované s klientem (server je
  dotáhne filtrem `assigned to: me`); takové přijdou bez klienta do inboxu
  a zařazení pod klienta jim stažení nesebere, úklid se o ně opře jen když
  projde i dotaz na hotové (`assignedProjects`). Nepřiřazené ani cizí úkoly
  se neberou a když úkol přiřazení ztratí, zmizí. Výjimky: úkol odeslaný
  z appky (Todoist ho přes API zakládá bez přiřazení — značka
  `Task.todoistFromApp`, jinak by si ho appka sama smazala) a podúkoly
  mého úkolu (jsou to položky checklistu). Bez `myUid` se neuklízí nic. Komentáře u úkolu bydlí v `Task.todoistComments` (offline i na druhém zařízení) a odpovídat jde z detailu; nové hlídá přírůstek přes `/sync` s uloženým `sync_token` (jedno volání za stažení) a cizí komentář rozsvítí `todoistUnread` na řádku úkolu. Podrobně v **`docs/TODOIST.md`** — zbývá spustit SQL a nasadit edge funkci
- [x] Fáze 9 — sdílení klienta s dalším uživatelem (`supabase/shares.sql`). Jednotka sdílení je **klient**: co pod ním visí (projekty, úkoly), je sdílené taky — s jednou výjimkou po úkolech: `Task.hiddenFrom` je seznam id lidí, kterým se TENHLE úkol neukazuje (u společného klienta se dělá i práce, do které kolegovi nic není). Hlídá to policy, ne UI — filtr v appce by řádek pořád posílal do cizího zařízení. Zakladatele klienta vyjmout nejde: majitele řádku pouští RLS vždycky, takže by odškrtnutí u jeho úkolu jen lhalo. Kdo je vyjmutý, na řádek nedosáhne, takže se sám vrátit nemůže; jeho lokální kopii uklidí `sweepVanished` (u sdílejících proto běží po půlhodině, ne jednou za den — o zmizelý řádek se kurzorový pull nedozví). Úkoly bez klienta zůstávají soukromé, stejně jako šablony a denní plány. Nestaví se druhý synchronizační kanál — jen se **rozšíří RLS** (policy `vlastni a sdilene` porovnává `data->>'clientId'` proti `shared_client_ids()`), takže sdílené řádky natečou stávající cestou pull → Dexie → UI a odškrtnutí se vrací zpátky přes LWW úplně stejně jako mezi dvěma zařízeními jednoho člověka. Správa přes security-definer RPC (`share_client`/`unshare_client`/`list_client_shares`/`my_shares`), klient na tabulku `shares` přímo nedosáhne. Dvě věci, které se dají snadno rozbít: (1) kurzorový pull na změnu rozsahu sám nereaguje — nově zpřístupněné řádky mají staré `updated_at`, takže se při změně otisku sdílení nulují pull kurzory (`ensureShareScope`, čistá logika v `src/sync/shareState.ts`); (2) úklid po odebraném sdílení musí být **tvrdý lokální výmaz, nikdy tombstone** — ten by se odsynchronizoval zpátky a smazal data majiteli. Zjišťování sdílení, které selže, se bere jako „nevím" (ne jako „nic nesdílím"), jinak by výpadek sítě spustil mazání. Vlastnictví řádku hlídá `lww_guard`, který při každé úpravě vrátí původní `user_id`. Přepnutí účtu na jednom zařízení teď lokální data maže — bez toho by je plný push nahrál do cizího účtu. Odesílání i úklid stojí na evidenci odeslaných verzí (`pushState`, čistá logika v `src/sync/outbox.ts`): (a) posílá se, co se od evidované verze liší — časový kurzor ztrácel změny pokaždé, když stažené razítko z druhého zařízení (hodiny napřed) posunulo kurzor nad čas následujících lokálních zápisů; (b) záznam odmítnutý serverem se izoluje, zbytek dávky projde a počet se hlásí do `SyncStatus.refused` — jedna nešťastná úprava nesmí umlčet odesílání napořád, a proto se u JEDINÉHO odmítnutého záznamu v dávce schválně nevyhazuje chyba; (c) `sweepVanished` jednou denně — u sdílejících po půlhodině — a při změně rozsahu sdílení zahodí lokální kopie toho, co server nezná — kurzorový pull se o zúžení rozsahu nedozví. Úklid nikdy nesahá na neodeslanou práci a přeskočí tabulku, jejíž seznam ze serveru nedošel celý; půlka seznamu vypadá jako „zbytek zmizel". Před zapomenutím klienta se napřed odešle, co čeká — jinak by o offline založené úkoly přišel ten, komu sdílení právě vzali.

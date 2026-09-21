# Todo-app — chytrý todo + kalendář

Osobní PWA pro marketéra, který řídí práci pro více klientů. Kompletní plán,
zdůvodnění rozhodnutí a roadmapa fází: **`docs/PLAN.md`** — před většími zásahy si ho přečti.

## Příkazy

- `npm run dev` — vývojový server
- `npm run build` — typecheck (`tsc`) + produkční build
- `npm test` — vitest (hlavně parser rychlého zadávání)
- `npm run typecheck` — jen typecheck
- `npm run audit:ui` — proměří symetrii, hrany prvků nad sebou, **levou
  hranu názvů v seznamu**, velikost cílů pro prst, přístupné názvy polí,
  **kontrast textu** (WCAG AA) a to, že **zaměření prvek nepřetvaruje**,
  na všech obrazovkách i v panelech, ve světlém i tmavém režimu.
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
- `npm run ikony` — ikony appky z jedné předlohy (`public/favicon.svg`,
  PNG se renderují z něj). Pusť po každé změně značky nebo palety.
- `npm run nahled` — obrázky appky do `.snimky/` (obě schémata, rozměr iPhonu).
  **Vzhled posuzuj z nich, ne odhadem.** Chromium bez GPU vykresluje
  `backdrop-filter` po dlaždicích — sklo doku by vyšlo rozmazané jen v pruhu
  uprostřed, proto skript vynucuje softwarový ANGLE/SwiftShader. Ten je ale
  pomalý, takže se před každým snímkem čeká na doběhnutí animací
  (`document.getAnimations()`), ne na stopky — jinak snímek chytne panel
  v půlce výjezdu a straší na něm druhá patička. **Ukázková data mají
  klienty** (zakládají se přes rozhraní, úkoly se zařadí přes `@jméno`) —
  bez nich je pruh dne jen šedá kolej a snímky neukážou zrovna to, čím
  appka vypadá jako ona sama.

## Architektonická pravidla (neporušovat)

1. **Offline-first.** Zdrojem pravdy je IndexedDB (Dexie, `src/db/db.ts`). UI čte a
   zapisuje výhradně přes vrstvu `src/db/repo.ts` a nikdy nečeká na síť.
   Komponenty nikdy nevolají síť přímo — síť smí jen synchronizační vrstva
   `src/sync/` (engine), která běží na pozadí: pull → push, konflikty LWW podle
   `updatedAt` (server má stejný guard jako trigger, viz `supabase/schema.sql`).
   Repo hlásí zápisy přes `src/db/events.ts`, engine na ně reaguje debounced
   pushem. **Co odeslat, se pozná podle evidence odeslaných verzí
   (`pushState`, logika v `src/sync/outbox.ts`), NIKDY podle času** — časový
   kurzor tiše ztrácel změny, kdykoli se rozešly hodiny dvou zařízení. UI čte stav syncu jen přes `src/sync/status.ts`. **Spouštěče syncu se
   slučují** (`src/sync/koalescence.ts`, čistá logika s testy): o sync si
   říká pět míst a dvě z nich přijdou v TÉMŽE dispatchi, takže se bez
   slučování dělal plný průchod dvakrát hned po sobě — zrovna po připojení
   k síti. Rozlišuje se přitom KDO požádal: **pouhý spouštěč se připojí
   k běžícímu, ZÁPIS si vynutí druhý průchod** (push posílá to, co našel na
   začátku, takže úkol založený v půlce syncu by jinak čekal na další tik).
   **Pád startu sync vrstvy se musí ošetřit a opakovat**: `supabase-js` se
   dováží dynamicky, a když se ten import jednou nepovede (neúplná precache,
   vyhozená cache), zůstal by stav navždy na „Spouští se…", posluchače by se
   vůbec nezaložily a appka by se do restartu nesesynchronizovala — tiché
   a trvalé zároveň. O čerstvost se
   stará jeden plánovač `src/sync/live.ts` — tiká, dokud je appka v popředí
   a je signál (vlastní data a **celé okno kalendáře** po minutě, Todoist
   po pěti), a při
   návratu signálu, přepnutí wifi ↔ data i po probuzení zařízení stáhne
   všechno hned. **Spouštění syncu patří jemu, ne jednotlivým modulům** —
   engine si na `visibilitychange` nechává jen obnovu push odběru, kalendář
   a Todoist svoje `maybeRefresh*` s minimálním intervalem. Duplicitní
   posluchač u kalendáře a Todoistu nic nestojí (interval ho utne), u syncu
   stál celý druhý průchod, protože žádný takový strop nemá. **Pozor:
   stub v `live.test.ts` drží posluchače v mapě klíčované `win:online`,
   takže druhá registrace tu první přepíše — duplicitu tenhle test
   z principu nechytí, hlídá ji jen jedno místo registrace.** Na pozadí se
   netahá nic — od toho jsou push notifikace.
1b. **Živá data mezi lidmi** (`src/sync/realtime.ts`). Zápis se odesílá po
   `WRITE_DEBOUNCE_MS` a druhé zařízení se ptalo jednou za minutu, takže
   odškrtnutí u kolegy bylo vidět **až za minutu** — u společné práce to
   nevypadá jako pomalý sync, ale jako rozbitá appka. Realtime to řeší,
   ale **NENÍ to druhý zdroj dat**: událost je jen ŤUKNUTÍ („na serveru se
   něco změnilo") a appka na ni odpoví stávajícím pullem. Tři důvody, proč
   zrovna takhle: (a) nevzniká druhá cesta, na které by se dalo rozejít
   s LWW a tombstony — pravidlo „nestaví se druhý synchronizační kanál"
   platí i tady, realtime je urychlovač; (b) na obsahu události nezáleží,
   takže z ní nemůže nic uniknout, ani kdyby přišla o cizím řádku;
   (c) když spojení spadne, appka se chová jako dřív — plánovač po minutě
   je pořád pod tím, takže to není bod, na kterém by se dalo selhat úplně.
   Události se slučují (`SECKANI_MS`): odškrtnutí sáhne i na klienta
   (`lastActivityAt`), takže přijdou dvě těsně za sebou, a hromadná úprava
   jich pošle padesát. Publikace se zapíná v `supabase/pozvanky.sql`
   (`tasks`, `projects`, `clients`). `WRITE_DEBOUNCE_MS` je kvůli tomu
   1 s místo 2,5: sečkání pořád slučuje dávku, ale je to ta půlka
   zpoždění, kterou kolega na druhé straně opravdu vidí.
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
   pozadí. **Odhad času si appka nehádá.** Heuristika, která razítkovala `estimateMinutes`
   podle klíčových slov v názvu, byla zrušena — netrefila 53 % úkolů a zbytku
   dávala dvě hodnoty, takže z ní vznikalo přesně vypadající číslo, které nikdo
   nespočítal. Minuty smí do appky vstoupit jen měřené: délka schůzky
   z kalendáře a `duration` z Todoistu. Kde se dřív soudilo z odhadů (strop dne,
   pruh dne, volnější den), se počítají ÚKOLY.
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
nad dokem (`.tab-on`). **Sklo drží pohromadě tři bílé závoje zadané
krytím — prstenec po obvodu (`::before`), prosvětlení (`::after`)
a výplň čočky — a to je v tmavém režimu past.** Ve světlém se všechny
tři utnou o bílou a nejsou po nich ani stopy (deska je 253–254 po celé
kapsli, jedna plocha); na tmavém podkladu z týchž čísel vyleze obrovský
vjemový krok, protože oko nevnímá jas lineárně. Změřeno ze syrových
pixelů, rozdíly `L*` proti sousednímu místu:

| | světlý | tmavý dosud | tmavý nově |
|---|---|---|---|
| prstenec po obvodu | 0,46 | 31,1 | 15,0 |
| deska shora dolů | 0,09 | 5,9 | 0,40 |
| čočka proti desce | 0,94 | 11,5 | 4,41 |

Z doku byla v tmavém **obtažená krabice se světlejším flekem uvnitř**
a k tomu stínovaná, protože prosvětlení po ní vedlo spád — proto je
teď ploché a nejde na nulu. Na světlá čísla to nikdy nedojede a nemá:
ve světlém drží kapsli i čočku **stín**, a na desce o `L*` 8 nemá stín
kam ztmavit, takže tam tu práci musí odvést světlo. Totéž platí pro
zdvih za jízdy (světlý 0,35, tmavý 2,54) — ve světlém ho dělá
prodloužený stín, v tmavém jas.

**Měří se ze syrových pixelů snímku, ne výpočtem z krytí**: prohlížeč
skládá vrstvy v zakódovaném sRGB, ne v lineárním světle (bílá 0,106 nad
deskou 22 dá `22·0,894 + 255·0,106 = 47`, na pixel přesně) — lineární
výpočet dá o polovinu jiné číslo, než co je na displeji, a přesně na
tomhle se dřívější hodnota u čočky spálila. Vzorkovat se přitom musí
**s obsahem pod dokem** (na prázdné appce se světlé sklo utne o bílou
a vyjde z něj dokonalá plocha i tam, kde by plochá nebyla) a **jen
uvnitř kapsle** (v rozích obdélníkového vzorku leží stránka, ne dok —
a poloměr se při maskování musí zastropovat půlkou kratší strany,
protože `rounded-full` je poloměr v tisících). **Složený dok je úzký** (`DOK_SIRKA` v `App.tsx`,
306 px, `mx-auto`): tři sloty po 64 px = přesně šířka čočky, mezery
20 px, okraje 6 / 8 px, takže čočka (44 v 56) i plusko (40 v 56) sedí v rozích
kapsle se stejnou mezerou jako svisle a zaoblení vrstev je
**soustředné** (28 − 6 = 22, 28 − 8 = 20). Dřív se záložky roztahovaly
na třetiny celé šířky (366 px) a čočka měla vlevo 28 px, nahoře 6;
se 4px mezerami (262 px) byl dok moc sevřený, 306 je střed. Otevřené
zadávání dostane celou šířku (`max-width` s přechodem). **Dok sedí
níž než bezpečná zóna**: patička má `max(8px, safe-area − 10px)`,
takže na iPhonu s indikátorem je spodní hrana 24 pt nad displejem (jako
tab bar iOS 26), bez indikátoru a nad klávesnicí zůstává 8 px. Polohy ikon se
dělí měřítkem pásu (`stredVuciPasu`) — dok přijíždí zmenšený na 0,94 a
čočka se usazuje během nájezdu; bez přepočtu stála po každém startu
o 2 px vedle. Přepnutí má **tři fáze a nic se nedeformuje**
(předchozí verze letěla jako kapka a natahovala se mezi záložkami —
hravé, ne přesné): (1) **stisk** — ikona pod prstem se stlačí na 0,9
hned při dotyku (`stisknuto` v kontextu, pružina 600/32), ještě než se
cokoli vybere; (2) **zdvih a klouzání** — čočka se nadzvedne (`ZDVIH`
1,07, stín se prodlouží a sklo zesvětlá přes `data-leti`) a **jednou
pružinou** (400/32/0,85 — rychlý rozjezd, dlouhé dobrždění, přestřelení
pod pixel) překlouže k cíli; během jízdy po ní přejede **odlesk**
(`.tab-lesk`): pruh světla stojí ve světě, ne na skle, takže se vůči
čočce posouvá proti směru jízdy — polohu i jas mu dává `useVelocity`,
v klidu je neviditelný; ikony, kolem kterých sklo jede, se pod ním
nadzvednou (o 3 px, jen pod letící čočkou) a přitáhnou (lom), pod
stojící čočkou je ikona jen o 6 % větší; (3) **dosednutí** — zdvih se
povolí, až když se čočka opravdu zastaví (rychlost pod `PRAH_KLIDU`, ne
stopky; pojistka `LET_MAX_MS`), nová ikona vyjede zespoda jako
`replace.downUp` u SF Symbols (+5 px, 0,88 → 1, odraz 0,4) o 120 ms po
vzletu — ve chvíli, kdy na ni sklo dojíždí, stará lehce klesne, vybraná
ikona zesílí tah (1,7 → 2,1). Změřeno po 8 ms: čočka 38 → 245 px za
~300 ms, zdvih 64 → 68,6 px, odlesk svítí jen za jízdy, dosedne v 340 ms.
Průzkum: tab bar iOS 26 (kapsle, která chytá světlo), SF Symbols
`replace.downUp`, zásady E. Kowalského (stisk 0,9–0,97 jako okamžitá
odezva, pružina místo keyframes, protože jde přerušit). Když prst na
doku zůstane a táhne, čočka se odlepí a jede s ním — pružina za prstem
lehce zaostává, ikona, kolem které projíždí, se nadzvedne, a puštění
vybere záložku nejblíž prstu. Podpis vybrané ikony (fajfka, linka data,
druhá postava) se dokreslí tahem (`motion.path`, `pathLength`) a dok
při startu vyjede zespoda. Tři věci, které se tu dají rozbít: (1) gesto stojí na
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
nic se nezvedá, nesvítí ani nenadýmá.
Zadávání úkolu v doku má **jednu stavovou řádku** (Termín / Klient /
Projekt / Priorita — prázdný slot nabízí, vyplněný ukazuje hodnotu,
otevřený je plný akcent) a **jeden panel nad ní**, do kterého se vejdou
všechny výběry. V kalendáříku u zadávání je jediná plná výplň vybraný den, dnešek má
kroužek a vytížení dne je tečka pod číslem — dřív mělo „něco tam je"
i „tohle jsi zvolil" tutéž modrou a nešlo je rozeznat. **Plán stojí na téže
mřížce**, jen větší a s pruhem dne místo tečky — dva různě vypadající
kalendáře v jedné appce jsou dva jazyky. Otevření termínu
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

**Panel stojí na VIDITELNÉM obdélníku, ne na stránce** (`.sheet-backdrop`
v `index.css`). Panel se renderuje portálem do `<body>`, tedy mimo
`.app-shell` — a ten se na `--vv-top`/`--vvh` chytá sám. `fixed inset-0`
ho proto drželo na spodní hraně STRÁNKY, kam otevřená klávesnice
nedosáhne: z detailu úkolu zbyla na displeji jen hlavička „Úkol ·
Připnout" a pole, do kterého se zrovna psalo, leželo pod klávesnicí
(změřeno: spodní hrana panelu 844 místo 524, pole na 597). Že jde
opravdu o tohle, bylo vidět na témž snímku — appka pod panelem klávesnici
uhnula (dok vyjel nad ni), panel jediný ne. **`bottom` se musí přebít na
`auto`**: s `top` i `bottom` zároveň vyhraje dopočítaná výška nad
`height` a panel se natáhne zpátky pod klávesnici. Strop výšky je
`--sheet-max` (nastavuje `App.tsx` vedle `--dock-safe`): **90 % je záměr**,
ať je za panelem vidět kus appky, ale nad klávesnicí by těch 90 % nebylo
z obrazovky, nýbrž z toho, co po ní zbylo — tam patří celá výška.
Odsazení zdola bere `--dock-safe`, ne `env(safe-area-inset-bottom)` přímo:
nad klávesnicí domovní lišta není a safe-area by z něj udělala prázdný
pruh. Hlídá to audit chování — klávesnice se v Chromiu nevyvolá, ale appka
o ní ví jedině z `visualViewport`, takže se přepíše a pošle `resize`, což
je přesně ta událost, kterou dostane na telefonu; měří se geometrie, ne
styl. Ověřeno vrácenou vadou: s `inset-0` spadnou obě kontroly.

**Panel se zavře stažením — za úchyt i za plochu** (`Sheet.tsx` +
`.sheet-grip`). Úchyt zůstává tou viditelnou nabídkou („chyť mě tady")
a jediným místem s `touch-action: none`; stáhnout jde ale i za obsah,
**dokud je panel odrolovaný nahoře**. Při odrolovaném obsahu patří tah
rolování, jako dosud.

Dřív se chytal jen úchyt a prst na obsahu spustil **pružné přetažení
vlastního rolování panelu**: uvnitř krabice sjel obsah dolů, krabice
zůstala stát a nad úchytem se otevřela prázdná plocha v barvě panelu.
Vypadá to jako dvě vrstvy, z nichž se hýbe ta špatná.

Jsou to dvě různé vady a každá chce něco jiného:

1. **Ta prázdná plocha je odskok vlastního rolování.** Panel měl
   `overscroll-behavior: contain`, což zabrání jen přenosu rolování na
   stránku pod panelem — vlastní odskok nechá být. Musí být **`none`**.
2. **Tah za plochu potřebuje touch events, ne pointer events.** Změřeno
   v prohlížeči: při tahu na rolovací ploše přijde `pointercancel`
   **už po prvním pohybu**, a přijde i tehdy, když je panel nahoře
   a odskok vypnutý — tedy když není co odrolovat. Prohlížeč si gesto
   bere tak jako tak a jediné, co ho zastaví, je `preventDefault`
   v **non-passive** `touchmove`. (Dřívější komentář v souboru tvrdil, že
   za plochu to nejde; nešlo to přes pointer events, což není totéž.)

`preventDefault` se volá **jen když se stejně nedá rolovat**: panel je
nahoře, tah míří dolů a je **svislejší než vodorovný**. Ta podmínka je celá
pojistka — gesto, které by něco odrolovalo, se nikdy nevezme, a kdyby ho
Safari nevyslyšelo, je chování jako dřív (tah neudělá nic), ne rozbité.
Ten test na směr tam není pro pořádek: **prevence platí na celé gesto**,
takže jedno ukvapené zavolání hned na prvním ťuknutí by umrtvilo vodorovné
rolování řádky chipů — a ta je uvnitř panelu skoro všude (sloty v detailu
úkolu, barvy, rychlé dny). Úchyt si dál jede po
své ose přes pointer events a pointer capture; obě cesty hlídá příznak
zdroje, aby se v jednom tahu nepotkaly a nepočítaly rychlost dvakrát.

Co platí dál: (a) nájezd a sjezd dělá **přechod, ne animace s `fill: both`**
— animace v kaskádě přebíjí inline styl, takže se panel prstem nehnul ani
o pixel, i když se poloha poctivě zapisovala; (b) `preventDefault`
v touchmove Safari neposlouchá, **jakmile se rolování jednou rozjede** —
proto ta podmínka výš, která ho volá dřív, než by se co rozjelo;
(c) tah **nezačíná nad textovým polem** (`input`, `textarea`,
`contenteditable`) — tam patří kurzor a výběr textu, ne panel.
Vzor: vaul od E. Kowalského.

**Karty nemají prstenec.** `--shadow-card` je jen dotek, který kartu
nenechá vypadat nalepenou; hloubku dělá kontrast papír × karta a jediný
opravdový stín má to, co plave (`--shadow-float`: plusko, toast). Dřív měl
obrys každý prvek — karty, kulatá tlačítka nahoře, dok — a když má obrys
všechno, nezvedá se nic. Stejně tak: oddělovače v seznamu úkolů vedou
**od textu, ne od kraje** (`.task-li` v `index.css`, rodič dál dává
`divide-y`), zaškrtávátko má 24 px a obrys `edge` — a **jeho obrys nese
prioritu** (`border-danger` kritická, `border-note-ink` vysoká; jméno
zůstává pro čtečku). Dřív to byla tečka před názvem, jenže stála v toku
textu a odsouvala název o svou šířku: v seznamu o čtyřech řádcích pak
názvy začínaly na třech různých místech (změřeno 70 / 85 / 103 px) a
totéž dělal špendlík „Top 3 dne" (ten je teď mezi ostatními značkami
úkolu). **Levá hrana textu je v seznamu ta nejsilnější linka, kterou tam
typografie má** — před název nepatří v toku nic; hlídá to audit
rozhraní (`hrana nazvu`) na každém `ul`, po první řádce textu, ne po
rámu uzlu. Oranžová je `note-ink`, ne plná `amber`: plná má na bílé
kartě 2,2 : 1, což je pod prahem 3 : 1 pro prvek, který něco znamená
(změřeno). Dál platí:
hlavička Dnes je titulek + **jedna řádka** s kroužkem postupu (SVG, animuje
`stroke-dashoffset`), Plán je mřížka měsíce s pruhem času pod číslem a vybraný den rozepsaný pod ní,
primární akce mimo dok jsou tiché pilulky `well`, prázdné stavy prostý
text bez tečkovaného rámečku.

**Seznam úkolů není krabice** (`.seznam-na-papire` v `index.css`).
Dnes, Vše i detail klienta jsou jeden seznam přes celou obrazovku
a karta kolem něj neoddělovala nic od ničeho — jen ubrala 16 px z každé
strany a přidala obrys tam, kde už jeden je (hairline mezi řádky).
Rozdíl papír × karta má smysl u toho, co je vsazené DO stránky (souhrn,
nastavení, agenda jednoho dne v Plánu — ta kartou zůstává, protože říká
„tohle patří tomu dni nahoře"); u seznamu, který stránkou JE, je to
krabice kolem všeho. Řádky teď stojí přímo na papíře: zaškrtávátko
začíná na **16 px**, tedy na téže svislici jako titulek a nadpis sekce,
a název na 54. Pravidlo je jedno a platí na každém patře: **každý box
jde k hraně displeje a odsazení 16 px si nese sám** — pozadí řádku,
stisk i barva pod taženým prstem tak sahají až tam, kam sahá prst, ale
text všude stojí na svislici. Tři věci, které se tu dají rozbít:
(1) šířku je nutné přepočítat na `calc(100% + 32px)`; `w-full` je
`width: 100 %` z šířky RODIČE, takže řádka triáže dojela vlevo ke kraji
a vpravo skončila o 32 px dřív (změřeno auditem: 0/320 proti 16/272),
a `auto` to nespraví — u `<button>` je to šířka OBSAHU i s `display:
flex` (změřeno 123 px); (2) patro se nesmí vynechat: `ul` bez vlastního
odsazení hlásil jinou hranu obsahu než tlačítka vedle něj, i když bylo
obojí vidět stejně — proto nosí `px-4` i ono a hlavička skupiny má
odsazení až uvnitř `li`, aby byly řádky navzájem stejné; (3) podklad
řádku je **proměnná `--radek-podklad`**, ne pevná barva: TaskRow stojí
i uvnitř karty a tam musí zůstat bílý, a přepsat mu pozadí selektorem
nejde — nevrstvené CSS přebíjí utility, takže by spolklo i `hover:`
a `active:`, tedy odezvu na stisk. Hlavička skupiny (klient, projekt)
nemá linku pod sebou (`.skupina-li`): odděluje ji mezera nad ní, ne
rámeček — linka pod nadpisem by ho oddělila od toho, co pojmenovává.

**Pruh dne je jazyk appky, ne ozdoba jedné obrazovky**
(`src/lib/pruhDne.ts` — čisté funkce s testy, `src/components/PruhDne.tsx`).
**Délka je práce v ÚKOLECH** (jeden díl = jeden úkol) proti **osobnímu
stropu** (`prutok.ts`), barvy jsou klienti, **neutrální díl je `edge`** —
práce bez klienta. Kreslí se v Plánu pod číslem každého dne v mřížce
(v malém, 28 px) i přes celou šířku u vybraného dne, a na Dnes pod
hlavičkou.

**Dřív to byly minuty z `estimateMinutes` a celý pruh byl osm hodin** —
jenže to číslo appka neměřila, hádala ho heuristika o osmi klíčových
slovech: 53 % úkolů ho nemělo vůbec (tiše se za ně počítala hodina)
a zbytek měl jen dvě hodnoty (30 a 90). Pruh tedy kreslil přesně
vypadající obrázek z čísla, které nikdo nespočítal — den se dvěma úkoly
mohl vyjít delší než den se čtyřmi podle toho, jestli se v názvu trefilo
klíčové slovo. Teď je jednotka jeden úkol, tedy **táž jednotka, ve které
appka měří strop dne**: plný pruh a verdikt nad ním konečně znamenají
totéž. **Strop se proto musí podat i mřížce** (prop `strop`) — kdyby si
buňka brala náhradní základ, má jedna obrazovka dvě měřítka a den vypadá
v mřížce jinak plný než hned pod ní; okem se to nepozná (pruh v buňce je
28 px), takže to měří audit chování poměrem zaplnění, ověřeno vrácenou
vadou (0,50 proti 1,00).

**Schůzky v pruhu nejsou.** Dokud měřil čas, patřily do neutrálního dílu
— schůzka čas zabírá. V kusech by ale byla „jeden úkol", což není pravda,
a pruh by zase říkal něco jiného než strop, který je výhradně o mojí
práci. Kolik času mezi schůzkami zbývá, říká měřená věta z kalendáře
(„zbývá ~3 h"), ne tenhle obrázek.

**V mřížce prázdný den značku nedostane**: na řádku přes celou šířku
platilo „graf s nulou má pořád osu" a prázdný den měl tichou kolej, ale
třicet kolejí vedle sebe je šedá tapeta a značka přestane znamenat
cokoli — v mřížce je osou sama mřížka. Na Dnes nahradil barevnou tečku
před větou o vytížení: tečka říkala jen „je toho moc / je to dobré", což
pruh ukáže sám — a navíc řekne, **komu dnešek patří**. Není to nový blok,
je to tatáž řádka, která dostala svůj obrázek. Popisek pod ním zůstal,
ale **jen z podložených čísel**: „na den je toho moc · obvykle zvládneš
2 úkoly" a „zbývá ~3 h" z kalendáře; dřívější „práce ~11,5 h" byl součet
odhadů a stálo to hned pod titulkem, kde vedle toho svítí pravdivé
„0 z 12". Když není co říct, řádka se nekreslí. Neutrální díl byl dřív
`ink-faint`: to je barva textu a na pruhu přes celou šířku z ní byla
černá lišta — pod titulkem Dnes nejhlasitější prvek obrazovky. Barevná
je práce pro klienta, všechno ostatní je podklad.

**Značka je ten pruh, ne fajfka.** Ikona byla bílá fajfka v modrém
čtverci — to má na ploše každá druhá appka a neřeklo to nic. Teď jsou to
**tři pruhy pod sebou, Plán v malém**, v barvách, které appka sama rozdá
prvním třem klientům (`AUTO_ORDER`). Dlaždice je `--color-paper`, ne
akcentní modrá, a **splash z manifestu má touž barvu**, takže ikona
a startovní plocha jsou jedna souvislá plocha. Tři podoby a každá z jiného
důvodu: zaoblená dlaždice pro PWA, **bez zaoblení pro `apple-touch-icon`**
(iOS si maskuje sám a přes předem zakulacené rohy by zůstaly tmavé cípy)
a **maskable se staženým obsahem** do bezpečného kruhu. Jedna sada se
ověřovala okem na 120 / 60 / 32 / 16 px — jeden pruh se v malém rozpadl
na čárku, tři drží.

**Barva startu je `--color-paper`, jedna jediná.** Než se to srovnalo,
šly na cestě dovnitř tři šedé: `#f2f2f7` ze splashe (**studená iOS šeď**,
kterou tenhle design odmítá), `#f6f6f4` ze statické `theme-color` a teprve
pak skutečný papír `#f4f4f1`. Appka se při startu z plochy dvakrát
převlékla a v světlém režimu stavový řádek nikdy neseděl s obrazovkou pod
ním. Hodnota je na třech místech (`vite.config.ts` manifest, `index.html`
i jeho ranní ozvěna, `PAPER` v `src/lib/theme.ts`) — **musí být stejná**.

**Jedna svislice přes celou obrazovku.** Nadpis sekce (`.section-label`),
hlavička měsíce v Plánu, hrana karty i řádka dne začínají na **16 px**,
tedy na okraji stránky. Dřív měl `.section-label` `padding-inline: 4px`
a hlavička měsíce `px-1`, takže „Září" stálo na 20 a „13" pod ním na 16 —
čtyři pixely, které oko nepojmenuje, ale vidí je jako nepořádek. Stejná
kázeň platí pro hlavičku detailu klienta: **místo pro plovoucí lupu
a obláček si bere jen první řádka jména** (plovoucí rozpěrka 84 × 1 px
uvnitř `h1`), ne celá hlavička. Dokud se uhýbalo `pr-24`, ubíralo se
96 px i tam, kde žádná ikona není, a jméno se **uřízlo** („Ondra Fré…")
na obrazovce, kde bylo místa dost. Jméno člověka se zalomí, neuřízne.

**Nájezd obrazovky musí dosednout na OBOU osách** (`BlurFade`, `App.tsx`).
Plán stál natrvalo o 14 px vpravo — celá obrazovka mimo svislici, na které
stojí zbytek appky. Řetěz příčiny: směr nájezdu počítá `App` z `prevTab`
ref, takže hned po přepnutí vyjde `dir ≠ 0` → `'left'` → osa **x**, nájezd
z `+offset` (14 px). Jakmile efekt `prevTab` srovná, vyjde při dalším
překreslení `dir === 0` → `'up'` → osa **y**. Varianta `visible`
nastavovala jen `[osa]: 0`, takže se z ní klíč `x` ztratil — a motion
nechal x **zmrzlé** tam, kde zrovna bylo. Na Plánu se to trefí pokaždé:
živé dotazy (rozpočet dnů, kalendář) obrazovku překreslí hned po nájezdu.
Proto `visible` vrací na nulu `x` i `y` a `hidden` nastavuje druhou osu
na nulu — vzhled se nemění, jen se zaručí dosednutí.

**Posun celé obrazovky žádná míra symetrie nechytí**, protože vůči sobě
zůstane všechno srovnané; audit rozhraní hlásil čistý výsledek, zatímco
obsah stál na 30 px. Hlídá to teď kontrola, která měří **absolutní**
polohu obalu nájezdu proti 16 px. Měří se obal, ne titulek: ten v detailu
klienta legitimně stojí až za barevnou tečkou (44 px) a kontrola na něm
hlásila planý poplach.

**Ta kontrola musí být v `audit:chovani`, ne (jen) v `audit:ui`** — je to
rozdíl mezi pojistkou a testem. `audit:ui` seje data přímo do IndexedDB
ještě před načtením, takže živé dotazy doběhnou dřív, než se někam
naviguje, a po nájezdu už nic nepřekresluje: **ten závod tam nenastane
a s vrácenou vadou průchod projde.** `audit:chovani` zakládá data přes
rozhraní za běhu, takže se rozpočet dnů v Plánu dopočítá až po příjezdu —
a to je přesně ten okamžik, kdy se osa přepne. Ověřeno oběma směry:
s opravou 16 px na všech třech obrazovkách, s vrácenou vadou **spadne
jen Plán, na 30 px**.

**Co ujede za okraj, se rozplyne** (`.radka-mizi` v `index.css`).
Vodorovně scrollující řádky pilulek — chipy na Dnes, v Plánu, ve Vše
a u klienta, řádka slotů v detailu úkolu — mizely pod hranou displeje
řezem, bez jediného náznaku, že tam něco je (změřeno: slot „Opakování"
skrýval 208 px, chipy na Dnes 55 px). Maska sedí **přesně na přesahu
záporné marže** (16 px, `-mx-4 px-4`), takže dokud se neroluje, není
vidět: v přesahu nic nestojí a maska průhledné plochy nic nezmění.
Proto ji dostávají jen řádky, které k okraji schválně přetékají —
řádka zapuštěná v panelu by si zprůhlednila první i poslední pilulku.

**Prstenec zaměření nesmí prvek přetvarovat.** `:focus-visible` bydlí
v `@layer base`, aby ho přebilo `outline-none`, o které si říká každé
pole v appce — teprve pak je vidět stav, který si pole samo navrhlo
(obrys v akcentu, světlejší podklad). A hlavně: pravidlo **nesmí nastavovat
`border-radius`**. Dokud ho nastavovalo (na 6 px), měnila se při zaměření
kulatá pilulka hledání na obdélník — a protože se panel hledání zaměřuje
sám, bylo to první, co člověk viděl pokaždé, když si hledání otevřel.
Obrys sleduje zaoblení prvku sám od sebe. Měkký roh tam, kde si prvek
žádné zaoblení neurčil, dává `:where(a, button, summary, [role=button])`
— nulová specifičnost, takže každé `rounded-*` z markupu vyhraje.
Obojí hlídá audit rozhraní (`tvar pri fokusu`).

**Na MacBooku je to jiné rozvržení, ne zvětšený telefon**
(`src/lib/siroko.ts` — čistá funkce s testy, `components/BocniPanel.tsx`,
`components/DetailObal.tsx`). Na 1440 px stála appka jako telefon
uprostřed monitoru — změřeno: sloupec 512 px a 464 px prázdna po každé
straně — a navigaci držel dok, tedy kapsle pro palec, která visí NAD
obsahem, protože na 390 px není kam ji dát. **Rozhoduje šířka okna, ne
druh zařízení**: iPad na šířku i Mac s appkou v poloviční obrazovce jsou
tentýž případ, a kdyby se appka ptala na `pointer: fine`, zůstala by na
dotykovém iPadu navždy telefonem. Práh je 1024 px — nejmenší šířka, kde
se vedle sebe vejde boční panel (232), seznam a detail (420). Čte se
**živě** (`useSiroko` poslouchá `resize`): appka běží přes Safari →
Přidat do Docku, takže se okno roztahuje pořád. Co se od prahu mění:
(1) **navigace je boční panel a dok se nekreslí** — dvě navigace naráz
jsou dvě odpovědi na „kde to jsem"; „Vše" tu dostává **vlastní řádek**,
protože důvod, proč je v doku jen druhou polohou Dneška (tři sloty po
64 px čtvrtý nesnesou), tady neplatí a skryté gesto je na Macu horší než
položka, kterou je vidět — dvojí „1" funguje dál; (2) **detail úkolu je
sloupec vpravo, ne panel zdola** — to je celý důvod, proč se na Macu
kreslí jinak: odškrtávám a přepisuji termíny a přitom se dívám na další
řádek. Ostatní panely (nastavení, triáž, klient, ohlédnutí) zůstávají
modální i tady, protože jsou to úkony, které se dělají **místo** práce se
seznamem, ne vedle ní; (3) **obsah má strop 760 px a stojí uprostřed** —
řádek úkolu přes celých 828 px se čte špatně, oko ztratí řádek mezi
zaškrtávátkem a názvem. Tři věci, které se tu dají rozbít, všechny tiše:
(a) **zadávání úkolu bydlelo výhradně v doku**, takže jakmile se dok na
široko přestal kreslit, nešlo na Macu založit úkol vůbec — obrazovka
vypadá v pořádku a appka se nedá používat; na široko má vlastní lištu nad
obsahem; (b) prostřední sloupec potřebuje **`min-h-0`** — flexový prvek
má `min-height: auto`, takže se roztáhne na výšku obsahu; dokud bylo
`main` přímo v `.app-shell`, nevadilo to (prvek s vlastním rolováním má
`auto` = nula), ale obal rolování nemá a na Plánu s reálnými daty se
natáhl na 992 px uvnitř 844px obalu, takže dok (absolutní k němu,
`bottom-0`) skončil 148 px pod displejem a nešel stisknout — našel audit
rozhraní; (c) o **Escape** se praly dva posluchače na `window` (zkratky
v `App.tsx` ho při otevřeném zadávání berou jako „zavři zadávání") a
vyhrál ten navěšený dřív — první Escape sloupec nezavřel, teprve druhý.
Sloupec se proto hlásí do **téhož zásobníku jako panely**
(`pripojNadPanel` v `Sheet.tsx`): Escape patří tomu, co je navrchu, a
zkratky appky mlčí. Hlídá to audit chování (oddíl 12, devět kontrol,
každá ověřená vrácenou vadou) a oddíl 9 se kvůli prahu vrátil na 900 px —
od 1024 by tři jeho kontroly ztichly: „Esc složí zadávání" počítá
tlačítka „Nový úkol", kterých je v bočním panelu jedno pořád, a dvě další
čekají `.sheet-panel`, který sloupec nemá.

**Obrazovka není soubor.** Dvě největší komponenty se návrhem zjednodušily,
ale soubor se nezmenšil: `ClientsView.tsx` měl 808 řádků a `TaskEditSheet.tsx`
969. Rozděleno podle toho, co spolu doopravdy souvisí, ne podle délky:
`ClientsView` zůstal **rozcestníkem** (37 řádků), seznam klientů je
`views/ClientList.tsx` a detail `views/ClientDetail.tsx` — dvě obrazovky,
které spolu nesdílejí nic než data z repa. Z detailu úkolu odešly
`components/TodoistTalk.tsx` (konverzace má vlastní stav, síťování
i chybové hlášky) a `components/VyberDne.tsx` (kalendářík s rychlými dny
a rostoucí `textarea` — pole, která se chovají jinak, než HTML umí samo;
používá je i jiný panel). **Importy se v takovém dělení píšou ručně, ne
odvozují skriptem**: `noUnusedLocals` hlásí `TS6133` i u nepoužitých
lokálních proměnných a typových aliasů, takže automat, který „uklidí, co
tsc vypíše", rozřeže i deklarace mimo importy. Chování se nezměnilo —
jen se přesunulo; hlídá to celá sada auditů.

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
`BorderBeam` (jen ranní návrh — jediná karta, kterou napsal server;
**pohyb je přepsaný**: předloha animuje `offset-distance`, což neumí
předat kompozitoru žádný prohlížeč, takže to motion přepisoval z JS při
každém snímku a světlo se zastavovalo pokaždé, když appka překreslovala
seznam — změřeno při 4× zpomaleném procesoru rozptyl kroku ±35 % a
sedmkrát za pět vteřin úplné zastavení. Teď rotuje kuželový přechod přes
`transform` čistou CSS animací `.beam-svetlo`, tedy ±0 % i pod zátěží.
**Obíhající světlo smí jet jen na `transform` nebo `opacity`** — nic
jiného kompozitor nevezme),
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
přepisuje z JS a musí sedět s `paper`. **Značky v hlavičce se PÍŠOU do proudu
parseru, nepřepisují po něm** (`document.write` ve skriptu v `index.html`)
— a stálo to tři nasazení, než se přišlo proč. iOS čte `theme-color`
i `apple-mobile-web-app-status-bar-style` **při parsování hlavičky**,
takže statickou hodnotu vidí a pozdější `setAttribute` (ať už ze skriptu
v hlavičce, nebo z `theme.ts`) už ne. Změřeno na telefonu třikrát: pruh
nahoře šel pokaždé za vzhledem SYSTÉMU — světlý nad tmavou appkou, pak
tmavý nad světlou, pak zase světlý nad tmavou. Prostřední pokus vypadal,
že „tmavý režim funguje", ale byla to jen shoda: systém byl tehdy taky
tmavý. **Zapsaná značka je pro parser totéž co napsaná v HTML**, jen se
její hodnota rozhodne až za běhu. V tmavém režimu se píše
`black-translucent`: pruh je průhledný a kreslí ho stránka svým papírem
(proto `viewport-fit=cover` a `env(safe-area-inset-top)` v layoutu), bílé
hodiny na tmavém papíři sedí. Ve světlém se **nepíše vůbec** — bílé hodiny
by na světlém papíře zmizely a bez ní si pruh vezme barvu z `theme-color`.
`default` se nepoužívá nikdy: znamená „řiď se systémem". Tuhle vlastnost
**v prohlížeči změřit nelze** (v DOMu vypadá zapsaná značka stejně jako
přepsaná), takže audit chování kontroluje ZDROJ stránky: mimo skript
nesmí být ani jedna z nich. Ověřeno vrácenou vadou — statická
`theme-color` zpátky v hlavičce shodí tuhle kontrolu i počty značek. Barvy klientů zůstávají
systémová paleta iOS (`CLIENT_COLORS`) — jsou to štítky, ne brand.
Animace `rise`/`pop`/`sheet-*` respektují `prefers-reduced-motion`.
Ikony appky stojí na `paper` a barvách klientů (viz „Značka je ten pruh")
— **po každé změně palety je přegeneruj** (`npm run ikony`; předloha je
`public/favicon.svg`, PNG se renderují z něj). Akcentní modré už nejsou:
dlaždice musí sedět se splashem z manifestu, tedy s `--color-paper`.

## Výkon (měřit, ne hádat)

Optimalizuje se proti **profilu**, ne proti dojmu — sonda se 400 úkoly,
čtyřikrát zpomaleným procesorem a mediánem z několika opakování (jeden běh
je šum). Čtyři věci, které se ukázaly, a jak jsou vyřešené:

1. **Dok nesmí číst rozvržení za pohybu.** `DokZalozka` si počítala polohu
   uvnitř `useTransform`, tedy při každém snímku letu čočky: tři ikony ×
   dvě `getBoundingClientRect` × 60 fps, proložené zápisy stylů = vynucený
   přepočet rozvržení. V profilu přepnutí záložky to byla **nejdražší
   položka vůbec — 65 ms vlastního času**, víc než všechny funkce appky
   dohromady. Poloha ikony přitom na pohybu čočky nezávisí. Teď se měří
   při **změně rozvržení** (`preemer()` v `DokZalozky`): `ResizeObserver`
   na pás **i na jednotlivé ikony** (Dock z magicui je pod kurzorem
   zvětšuje a tím posune sousedy — posun sám o sobě RO nespustí, proto se
   při každém hlášení přepočítají všechny) plus pojistné přeměření při
   stisku. Transform je pak jen odečtení dvou čísel. Změřeno: tah čočkou
   −21 %, `getBoundingClientRect` z profilu zmizel. Pozor: hlídač ikon má
   **vlastní** `ResizeObserver` — kdyby sdílel příznak `prvni` s pásem,
   spotřeboval by ho svým okamžitým prvním hlášením a čočka by po startu
   skočila na cíl dřív, než pružina vyrazí.
2. **Odvozená data patří do `useMemo`.** Obrazovky se překreslují i když
   se jen otevře panel, tikne minuta nebo se píše do pole — a bez memoizace
   se při každém takovém překreslení znovu procházelo a třídilo všech 400
   úkolů, stavěly se mapy klientů a projektů a počítaly signály (nejdražší
   průchod na Dnes). `useLiveQuery` vrací tutéž referenci, dokud se dotaz
   znovu nespustí, takže závislosti drží. V Plánu je celý rozpočet dnů
   v jednom `useMemo` — dřív každé písmeno v poli „Nový úkol na sobotu…"
   přepočítalo schůzky, rozdělení úkolů po dnech i pruhy zátěže.
   **Hooky musí stát nad podmíněnými `return null`** (v `ClientDetail` se
   na tom dá shodit celá obrazovka: `client` je z živého dotazu, takže
   první vykreslení skončí dřív a druhé už ne).
3. **`TaskRow` je přes `memo`.** V seznamu jich stojí třicet a bez toho se
   překreslily všechny pokaždé, když se v rodiči cokoli hnulo. Volající
   proto musí držet stabilní `onToggle`/`onOpen` (`useCallback`) a klienta
   s projektem podávat z **memoizované mapy**, ne přes `find` v každém
   řádku. Změřeno: dobrání dalších řádků −31 %.
4. **Nikdy `mapa.set(k, [...(mapa.get(k) ?? []), x])`.** Kopie celého pole
   při každém přidání je kvadratická práce — a na dnešek v Plánu padají
   všechny propadlé úkoly, takže se ta hromádka kopírovala pořád dokola.
   Správně je `push` do stávajícího pole.

**Balíček je rozdělený podle stability** (`manualChunks` ve `vite.config.ts`:
react / supabase / dexie / motion / rrule / prvky). Dřív šlo všechno do
jediného souboru (1,1 MB) a název nese otisk obsahu, takže jedno písmeno ve
vlastním kódu znamenalo stáhnout do telefonu **znovu celý megabajt** včetně
knihoven, které se nezměnily. Teď se mění jen balíček s kódem appky:
změřeno **316 kB místo 1,1 MB (28 %)** — a první vykreslení na 4G se
zrychlilo z **2018 na 1669 ms (−17 %)**, protože se balíčky stahují
souběžně.

**Supabase se na startu nestahuje** (`initSync` v `src/sync/engine.ts`).
Dřív tu stálo, že odložit ji nejde bez `React.lazy` na `SyncSheet` a že
by to přidalo viditelný suspense — to byla špatná diagnóza. `SyncSheet`
supabase-js vůbec neimportuje, bere jen API enginu; `@supabase/supabase-js`
si dováží **jediný soubor** a `createClient` se volá na **jednom místě**.
Stačí tam `await import()`: žádná komponenta se nelazyuje, žádný suspense,
na vzhled se nesahá. Jde to proto, že **UI na síť nikdy nečeká** —
zdrojem pravdy je Dexie — a `getSupabase()` odjakživa vrací
`SupabaseClient | null`, takže okno „klient ještě nedojel" je stav, který
sesterské moduly (kalendář, sdílení, Todoist) už ošetřují. Změřeno na
pomalé 4G (1,6 Mb/s, 150 ms), medián ze sedmi běhů: **první vykreslení
5964 → 4920 ms (−17,5 %)**, staženého JS **1068 → 858 kB**; chunk se
stahuje až jako poslední, 172 ms po startu.

Odložení si vyžádalo **vlastní fázi `starting`** (`src/sync/status.ts`).
Bez ní stav mezi startem a doječením klienta hlásil `unconfigured`, tedy
„sync nemáš nastavený" — u nastaveného syncu lež, i když jen na okamžik.
Změřeno oběma směry: s fází projde stav „Spouští se…" → „Nepřihlášeno",
bez ní „Nenastaveno" → „Nepřihlášeno". **Nová fáze musí přibýt do obou
map v `SyncSheet`** (`PHASE_LABELS`, `PHASE_COLORS` jsou
`Record<SyncPhase, …>`, takže na to upozorní typecheck) **i do testů na
přihlášení** v `ClientSharing` a `SharingSheet` — během startu ještě
není jisté, že přihlášeno je.

## Datový model

`src/db/types.ts`: Client (zároveň oblast: `client | internal | personal`) →
Project → Task; Template (balíčky pravidelných úkolů, Fáze 4), DayPlan (ranní
návrhy a reakce na ně, Fáze 6). Úkol může viset přímo pod klientem bez projektu.
Pravidelná připomínka kontroly klienta = opakující se úkol s markerem
`isClientCheck` (`src/db/clientCheck.ts`), marker přežívá respawn.
Položka checklistu (`Subtask`) má vedle názvu a odškrtnutí i vlastní
`dueDate` — pořád je to ale krok, ne úkol: bez klienta, priority
a naplánování, a do Plánu se nedostane (`src/lib/podukoly.ts`).
Týmová pole na úkolu (Fáze 10): `assignedTo` (kdo to má udělat),
`completedBy` (kdo odškrtl) a `ownerId` na `BaseRecord` — to poslední se
**nepíše z appky**, razítkuje ho stahování ze sloupce `user_id` a při
odesílání se zase odstraní.

## Stav fází (roadmapa v docs/PLAN.md)

- [x] Fáze 1 — kostra: PWA na plochu, lokální DB, klienti/projekty/úkoly, rychlé zadávání s českým parserem (`src/lib/quickAdd.ts`), obrazovky Dnes/Plán/Klienti
- [x] Fáze 2 — dvě zařízení: Google login, Supabase schéma (`supabase/schema.sql`), sync s tombstony (`src/sync/`) — kód hotový; zbývá jednorázově založit Supabase projekt podle README a ověřit na dvou zařízeních
- [x] Fáze 3 — Google Calendar: edge funkce `calendar` (events/scheduleBlock/deleteBlock; tokeny v `public.google_tokens`, OAuth údaje v `public.google_oauth` — RLS bez policies, jen service role). Klientská vrstva `src/sync/calendar.ts` cachuje události do Dexie (`calendarEvents`, okno `FETCH_WINDOW_DAYS` = 180 dní), obnovuje po syncu, po minutě z plánovače a při návratu do popředí. **Obnova jezdí po minutě, ne po pěti, a bere celé okno** — půl roku dopředu je pořád živé, ne jen nejbližší dny. Dřív tu stálo pět minut kvůli ceně plné obnovy (stažení všech kalendářů + `clear()` a přepis celé tabulky), jenže ta cena je jinde, než to vypadalo: stažení je **jeden** požadavek a zápis do Dexie je změřeně **9 ms na 500 událostí a 30 ms na 2000** (medián ze sedmi běhů, `fake-indexeddb`). Za tohle se schůzky zpožďovat nemusí. Interval je `55_000`, ne rovná minuta: plánovač tiká po 30 s, takže s rovnou minutou by se obnova trefila až na druhý tik (90 s). **Návrat do popředí neškrtí nic** — `lastFetchAt = 0` a rovnou `refreshCalendar()`; je to jediná chvíle, kdy člověk na schůzky KOUKÁ a data jsou zaručeně nejstarší, a dřív i sem platil minimální interval, takže po odemčení telefonu ukazovala appka schůzky z doby, kdy ho člověk zamykal. Okno **serveru se neměnilo**: akce `events` bere `from`/`to` odjakživa, takže tohle nepotřebuje nasadit edge funkci. Živá data končí u otevřené appky — **doručit změnu do zavřené appky by chtělo Google watch channels → webhook → Web Push**, což postavené není. Volná okna počítá `src/lib/freeSlot.ts` (server má kopii téže logiky — udržovat v souladu). Přijetí ranního návrhu zabere blok v kalendáři „Todo“ (délka = `estimateMinutes`, což je dnes už jen délka zadaná v Todoistu, jinak hodina — appka si ji nehádá); zrušení naplánování/smazání úkolu blok uvolní. Follow-upy ze schůzek: plusko u schůzky na Dnes založí úkol „Follow-up: …“ na dnešek (`addMeetingFollowUp`, deterministické id — bez duplikátů, tombstone vyhrává).
- [x] Fáze 4 — šablony (`src/db/templates.ts`), RRULE opakování (`src/lib/rrule.ts`, knihovna rrule), hlídání zanedbaných klientů. Instance šablon mají deterministická id (`src/lib/deterministicId.ts`) — obě zařízení generují totéž, sync nevyrábí duplikáty a tombstone smazané instance vyhrává. Pravidla šablon s INTERVAL>1 se kotví k `RULE_EPOCH`. Samostatný opakující se úkol se po dokončení sám založí na další termín (respawn v `completeTask`). Reconciler běží při startu, při návratu do popředí a po doběhnutí syncu; generuje 90 dní dopředu (dřív 30 — Plán je od té doby nekonečný a čtvrt roku dopředu má vidět i pravidelné úkoly).
- [x] Fáze 4.5 — tiché signály (`src/lib/signals.ts`, čisté funkce): zanedbaní klienti, klienti bez naplánovaného úkolu, projekty bez dalšího kroku, ležáky v inboxu, opakovaně odkládané úkoly (`postponeCount` počítá `updateTask` při posunu termínu na později; respawn ho nuluje). Zobrazuje blok „Nepropadá ti něco?" na Dnes (`SignalsBlock`), řádky navigují na klienta/úkol/inbox. Ranní návrh dne (Fáze 6) má z těchto signálů čerpat. **Hlídání ticha má výchozí práh, nemusí se zapínat** (`HLIDANI_VYCHOZI_DNI` = 14, `neglectedDays`): bezpečnostní síť, kterou si musíš u každého klienta zvlášť zapnout, není bezpečnostní síť. Změřeno na skutečných datech: `checkIntervalDays` neměl nastavený ANI JEDEN z pěti klientů, takže ten signál nemohl vzniknout vůbec — a přitom `lastActivityAt` se poctivě razítkuje při každém založení i dokončení úkolu, takže appka celou dobu VĚDĚLA, že klient „Chcinadhled" je 45 dní bez jediné stopy a bez jediného otevřeného úkolu, a mlčela. Čtrnáctka není odhad — je to číslo, které pole v nastavení klienta odjakživa ukazuje jako `placeholder`: rozhraní ho slibovalo, logika ne. **Výchozí práh platí jen pro KLIENTA, ne pro oblast**: „Osobní" a „Interní" jsou přihrádky na moji vlastní práci, ne vztah, který může utichnout — nadávat mi, že jsem si čtrnáct dní nezaložil osobní úkol, je hluk. Vlastní hodnota se ctí u čehokoli a **`0` je vědomé vypnuto** (prázdné pole = „nech to na appce"); panel klienta to řekne pod polem („hlídá se po 14 dnech" / „nehlídá se"), jinak by se výchozí stav nedal od vypnutého poznat. Na skutečných datech se signál ozve právě u toho jednoho klienta, který vypadl, a mlčí u zbylých (12, 5 a 1 den) — má zůstat vzácný a zasloužený. **Týž práh ctí i server** (`prahHlidani` v `supabase/functions/morning-plan/pick.ts`): ranní návrh z ticha u klienta skóruje a píše ho do odůvodnění, takže kdyby ho měla jen appka, stálo by na řádku klienta „ticho 45 dní" a návrh by o tomtéž klientovi mlčel — jedna appka se dvěma názory na téhož klienta. Konstanta je na obou stranách zvlášť (server se do prohlížeče neimportuje), hlídají ji testy v `pick.test.ts`.
- [ ] Fáze 5 — AI: chytřejší parsování čeká na model (Claude úloha přes předplatné, ne API). Hotové části, všechny bez modelu. **Zrušeno: tiché odhady času heuristikou** (`src/lib/estimate.ts`, osm klíčových slov → minuty). Znělo to jako laciný první krok k Fázi 5, ale bylo to číslo, které appka vydávala za znalost: změřeno na 45 úkolech provozu — 24 (53 %) heuristika netrefila vůbec (tiše se za ně počítala hodina), zbytek dostal jen dvě hodnoty (30 a 90 min). A protože appka čas neměří a měřit nezačne (stopky v todo appce jsou práce navíc, kterou nikdo nedělá), nešlo se z toho ani poučit — nebylo s čím porovnat. Viselo na tom přitom hodně: strop dne, délka pruhu dne, výběr volnějšího dne i věty typu „~4 h“ po celé appce. Všechno to dnes počítá ÚKOLY, protože **odškrtnutí je událost, kdežto odhad je dohad**; jediné minuty, které do appky smí, jsou měřené (délka schůzky z kalendáře, `duration` z Todoistu). Model tu odhady neoživí: odhadnout, jak dlouho bude trvat cizí práce, je pro model tentýž hazard jako pro osm regulárních výrazů, jen se hůř pozná. (2) **rozpad projektu na kroky** (`src/lib/rozpad.ts` — čisté funkce s testy, podklady sbírá `src/db/rozpadProjektu.ts`, panel `RozpadKroku` uvnitř `ProjektSheet`): zdrojem jsou **výhradně vlastní data** — projekt s podobným jménem, který už má úkoly. Markeťák dělá tentýž projekt opakovaně pro různé klienty a ty kroky leží v projektu, který je dávno uzavřený; tohle je odtamtud vytáhne. **Obecné kroky se nevymýšlejí** („Zadání / Návrh / Realizace") — to je přesně ten hluk, který se z appky maže druhý den — a **když se nic nepodobá, není vidět nic**, ani prázdný stav. Podobnost je překryv slov proti té MENŠÍ množině, ne Jaccard: „Rebranding webu" a „Rebranding webu pro e-shop" je tentýž projekt s delším jménem. **Jména klientů se z porovnání škrtají**, jinak by „PPC Alza" a „SEO Alza" vyšly jako příbuzné (sdílejí jen zákazníka) a „PPC Alza" a „PPC Bosch" ne. U kroku je vidět, odkud je; jméno klienta stojí **za oddělovačem, ne ve větě** — „u Alzy" chce druhý pád a ten se u libovolných jmen („V Bílém", „Ondra Fréz") neuhodne. Přidání je vratné, takže se neptá — ale **panel se musí zavřít dřív, než se toast ukáže**: toast má `z-40` a plachta panelu `z-50`, takže „Vrátit" pod otevřeným panelem nejde stisknout (našel audit chování; uzavření a smazání projektu to dělají stejně odjakživa). Model přes předplatné sem později přibude jako DALŠÍ zdroj kroků — mechanismus návrh → přijetí po jednom → úkoly na něj nečeká. (3) **parser rozumí řeči, kterou člověk píše doopravdy** — sonda přes třicet vět, jaké si markeťák zadá, ukázala tři druhy mezer, všechny tiché (co parser nepochopí, nechá v názvu): chybějící jednička („za týden" nebylo nic, „za 1 týden" fungovalo), předložky a zájmena viselé v názvu („připravit prezentaci **na**", „přenést data **tento**") a holá hodina, která nebyla čas („schůzka v úterý v 10" nechalo „v 10" v názvu a úkol bez času). **Holá hodina se bere JEN když za ní už nic nestojí** — konec věty, interpunkce, nanejvýš denní doba. Ta podmínka je celá pojistka: „porada v 10 lidech" je počet a „faktura do 15.9." je datum, obojí by se jinak přečetlo jako hodina a tiše přepsalo termín; obě věty mají test. Denní doba hodinu posouvá po našem („v 7 večer" = 19:00, „v 8 ráno" = 8:00, „v 12 odpoledne" pořád poledne). Dál: „do konce týdne" = „koncem týdne", „tento týden" míří na pátek, „po obědě" je 13:00, předložka smí stát i před „příští" („na příští pátek"). **„Za měsíc" je tentýž den v dalším měsíci, „příští měsíc" jeho začátek** — dvě různé věty, dva dny. A **„každé první pondělí v měsíci"** (i „každý poslední pátek") vyrobí `FREQ=MONTHLY;BYDAY=1MO`: pořadí 1.–4. nebo „poslední", skloňování podle rodu dne, „v měsíci" nepovinné; pátý výskyt by přetekl do dalšího měsíce, takže se nenabízí. Obyčejné „každé pondělí" zůstává týdenní — nová větev stojí v pořadí až za ní.
- [x] Fáze 6 — push notifikace + ranní návrh dne: pg_cron (5:00 UTC) → edge funkce `morning-plan` (skórování a výběr = čistá logika v `supabase/functions/morning-plan/pick.ts`, testuje `pick.test.ts`; česká odůvodnění; deterministické id DayPlanu) → upsert do `day_plans` + Web Push (`@negrel/webpush`, VAPID v `private.vapid_keys`, RPC `get_vapid_keys` jen pro service_role). Klient: vlastní SW (`src/sw.ts`, injectManifest) s push/notificationclick, přepínač „Ranní návrh dne" v SyncSheet (`enablePush` v engine), blok návrhů na Dnes s přijmout/zamítnout (`decideDayPlanSuggestion` — accept nastaví `scheduledFor`; rozhodnutí se syncují pro budoucí učení ve Fázi 5). Model zatím nezapojen — jen formulace šablonami. **V kolik návrh chodí, si člověk nastavuje** (`supabase/rano.sql`, tabulka `push_prefs`; čistá logika `maPoslat`/`cilOdkazu` v `supabase/functions/morning-plan/kdy.ts` s testy). Dřív chodil v 5:00 UTC, tedy v 7:00 v létě a v 6:00 v zimě — jenže to nebylo nastavení, ale vedlejší účinek toho, že cron umí jen UTC, a hodina, ve které člověk začíná den, je jeho věc. **Řešení není cron pro každého** (tolik úloh se neudrží), ale **obrácení odpovědnosti**: cron budí funkci každou půlhodinu v okně 3–11 UTC a FUNKCE se u každého člověka ptá, jestli už nastal jeho čas. Okno pokrývá pražských 5–13 v létě a 4–12 v zimě, takže volby 5:00–11:00 platí po celý rok včetně obou přechodů na letní čas. Pravidlo je „**v tuhle hodinu NEBO POZDĚJI, a jen jednou za den**": to druhé je pojistka proti tomu, aby půlhodinový budíček poslal totéž šestkrát (razítko `last_morning_on`), to první pojistka opačná — když funkce ráno vypadne, návrh se pošle v nejbližším dalším okně místo aby ten den propadl. **Chybějící nastavení znamená výchozí stav, ne vypnuto**; nesmyslný čas taky ne — notifikace, která tiše zmizí, je horší než notifikace ve špatnou hodinu. **Nastavení leží na serveru, ne v localStorage**: rozhoduje se o něm ve chvíli, kdy je telefon zamčený v kapse, takže musí ležet tam, kde ho uvidí edge funkce — a platí tím pro všechna zařízení naráz, protože je to vlastnost člověka, ne mobilu. **Zapisuje se jen přes RPC `set_push_prefs`**: appka nesmí na `last_morning_on`, jinak by uložení nastavení smazalo razítko a návrh by ten den přišel podruhé. **Přepínač odběru v SyncSheet je něco jiného** a jmenuje se teď podle toho („Notifikace na tomhle zařízení"): platí pro JEDNO zařízení a pro VŠECHNY druhy zpráv, takže kdo chtěl připomínky termínů, ale ne ranní návrh, musel dosud vypnout obojí. **Kam ťuknutí vede**, se taky volí (`morning_target`): `navrh` otevře rovnou panel s návrhy přes deep-link `#navrh` (řeší ho `TodayView` vedle `#shutdown`), `dnes` jen appku. Nedělní odkaz na týdenní ohlédnutí to nepřebíjí — je to jiná zpráva a vede jinam ze své podstaty. **Úkoly bez termínu se nabízejí vždy**: mají vlastní základ skóre (jinak by s normální prioritou spadly na nulu a filtr `score > 0` by je vyhodil) a v návrhu rezervované sloty, aby je nabité dny s termíny nevytlačily. Jejich mix je vážený prioritou — klesající stropy `UNDATED_CAPS`, nevyčerpaná kapacita se dobere níž, takže bez kritických nabídku vyplní vysoké. Strop „nejvýš dva od jednoho klienta" platí jen na skutečné klienty; úkoly bez klienta spolu nesouvisí a nesdílejí ho. Zamítnutí úkol nikam neposouvá, takže se druhý den nabídne znovu — to je ono „odložit na zítra". **Učení z rozhodnutí** (`pametUkolu`/`ohodnot` v `pick.ts`, žádný model; appka dováží TÝŽ soubor přes `src/lib/navrhPamet.ts`, takže co ukáže jako „vrátí se v pátek", to server v pátek udělá). Zásada nad pravidly: **odložení nikdy není zapomenutí** — každá pauza má den konce, který je vidět (panel návrhu: karta „Odpočívá" s „Vrátit"; inbox: štítek „odpočívá · vrátí se v pátek 18. září"; Plán: řádek „Vrátí se do ranního návrhu" v rozbaleném dni), a po jejím konci se úkol **tři rána nabízí přednostně** (`NAVRAT_DNI`, `NAVRAT_BONUS`, v `pickSuggestions` napřed, nejvýš `NAVRAT_MAX` za ráno — zbytek počká na další ráno) s důvodem `DUVOD_NAVRATU`; teprve pak spadne mezi ostatní. Odpovědi: „Dnes ne" (`rejected`) = zítra znovu, o 0,5 níž; **podruhé během 14 dní = týden pokoj** (`ODMITNUTI_PAUZA`, `PAUZA_DNI`) a toast to řekne i s datem (`kdySeVrati`); „Volnější den" (`snoozed`) = pokoj rovnou; „Už neplatí" jen u vracejícího se úkolu (`pamet.vraci`) = `status: 'dropped'`; bez odpovědi (`ignored`) = −0,3 za nabídnutí (strop 4×), aby se úkoly bez termínu střídaly; paměť 14 dní (`HISTORIE_DNI`). **„Bez odpovědi" se ale počítá JEN Z RÁNA, KTERÉ ČLOVĚK VIDĚL** (`videno` v `pick.ts`, razítko `DayPlan.seenAt`). `ignored` totiž neznamenalo „viděl jsem a nechal být", ale „nikdo se k tomu nevyjádřil" — a to je taky ráno, kdy se appka vůbec neotevřela. Změřeno na 44 ránech skutečného provozu: **21 z nich (48 %) nedostalo ani jednu odpověď a leželo v nich 58 z 68 ignorovaných, tedy 85 % všeho, z čeho se appka učila**. Na úkolech to znamenalo, že 21 z 39 neslo trest z rána, které nikdo neviděl, 6 z nich rovnou na stropu ztráty (−1,2) a 16 bylo trestáno VÝHRADNĚ tím — jejich celé „učení" si appka vymyslela. Úkol tak mohl vypadnout z nabídky za dovolenou svého majitele. Viděno se pozná dvěma svědectvími: **razítko `seenAt`**, které `oznacNavrhVidenym` zapíše při otevření panelu (chip „Návrh · 3" na Dnes se nepočítá — ukáže počet, ne jména, takže po něm nejde nic „nechat být"), a **jakákoli odpověď toho dne**, protože odpovídat jde jedině z otevřeného panelu — bez toho by se nepřiznala celá historie starší než razítko. Razítko se píše **jednou**: jinak by každé nahlédnutí posunulo `updatedAt` a poslalo celý plán znovu na server. Chyba padá úmyslně na stranu „radši se nepoučím" — podcenit ticho znamená nabídnout úkol znovu, přecenit ho znamená ztratit úkol, který nikdo neviděl; je to totéž pravidlo jako u zjišťování sdílení, kde **selhaný dotaz znamená „nevím", ne „nic"**. Hlídá to audit chování (oddíl 13, tři kontroly ověřené vrácenou vadou: razítko vznikne otevřením, ne chipem, a nepřepisuje se). „Vrátit" (`probudUkol`) přepíše odmítnutí a odložení z okna na `ignored` — rozhodnutí jsou jediný zdroj pravdy o pauze, úkol se nemění. Dva pohledy v appce (`useNavrhPamet`): DNES (co server ráno spočítal — kdo se vrací) a ZÍTRA (kdo odpočívá a do kdy; počítá i dnešní odpovědi, jako to zítra udělá server). Přijetí nic neupravuje. Plán připravený Claude úlohou tuhle logiku obchází (bere se hotový). **Kam se odkládá** (`src/lib/volnyDen.ts`, čisté funkce s testy): když datum vybírá appka, ne člověk, vybere **nejbližší pracovní den s nejmenší zátěží** v okně sedmi dní (zátěž = odhad úkolů s datem + délka schůzek, totéž co pruh v Plánu; víkend se přeskakuje, při shodě nejbližší). Den se volí při odpovědi a ukládá k rozhodnutí (`DayPlanSuggestion.until`), server ho jen ctí — bez něj platí pevný týden. Platí pro „Volnější den" v návrhu (od zítřka), pauzu po druhém „dnes ne" (až od třetího dne — dvakrát „ne" chce pár dní klidu) a „Volnější den" v triáži propadlých (nahradilo „Příští týden"; zátěž se počítá živě, takže pět úkolů z jedné triáže nespadne na jeden den). Gesto „Zítra" a večerní uzávěrka zůstávají doslovné.
- [x] **Dnes = hlavička, jedna řádka kontextu, jeden seznam.** Obrazovka dřív skládala až jedenáct bloků pod sebe (návrh, kalendář, chipy, připnuté, po termínu, dnes, tip, bez termínu, hotovo, uzávěrka, signály) a na „co teď?" odpovídala jedenáctkrát. Teď: (1) hlavička s kroužkem postupu; (2) **kontextová řádka chipů** (`Chip` v `TodayView`) — ranní návrh („Návrh · 3", jediný s BorderBeamem, otevírá `NavrhSheet`: název, důvod, „Přijmout na dnešek" / „Dnes ne", „Přijmout zbývající", „Zpět" vrací na `ignored` a u přijatého i `scheduledFor` a blok v kalendáři), nejbližší schůzka („15:00 First Steps · za 2 h", otevírá `KalendarSheet` s celým dnem a volnými okny), uzávěrka (večer), signály („Signály · 6", otevírá `SignalySheet`), bez termínu (vede do Plánu) — nic z toho není dnešní práce, proto nic z toho není sekce; (3) **jeden seznam na papíře, bez karty**: řádka triáže „po termínu · N · Projít" nahoře — **ale jen když nějaký termín opravdu propadl** (`popisPropadlych` v `src/lib/vseUkoly.ts`; jinak tiché „nestihnuto · N" v `note-ink`). „Kdy to je" je dřívější z termínu a NAPLÁNOVÁNÍ, a naplánování je den, který si člověk vybral sám: nestihnout vlastní plán je běžný čtvrtek, nestihnout termín je propásnutý slib. Změřeno na skutečných datech: appka hlásila červeně „po termínu · 8" a **ani jeden z těch osmi po termínu nebyl** — sedm žádný termín nemělo (11 ze 14 otevřených úkolů ho nemá) a osmý ho měl až ZÍTRA, takže se o den předem tvářil jako propásnutý. Řádek úkolu přitom mlčel: `TaskRow` barví datum jen podle `dueDate`, takže nad seznamem bez jediné červené položky stálo červené číslo a obrazovka si protiřečila. **Fronta zůstává jedna** — obojí se potřebuje posunout a dvě řádky nad jedním seznamem jsou dvě odpovědi na „co se nestihlo"; mění se jen jméno a tón. Při obojím naráz mluví řádka o termínu (hlasitější fakt) a počítá jen jeho, zbytek jede ve frontě s ním — „Projít" počet neslibuje. Kontrast změřen: 5,45 : 1 ve světlém, 10,81 : 1 v tmavém. Hlídá to audit chování (oddíl 14, šest kontrol ověřených vrácenou vadou — jméno i barva se čtou ze skutečné obrazovky, protože se dají rozbít i beze změny pravidla, stačí natvrdo napsané „po termínu" v JSX), pak **připnuté a pod nimi zbytek podle PRIORITY** (`src/lib/dnesPoradi.ts`, čistá logika s testy). Dřív to byly tři bloky za sebou — připnuté, propadlé, dnešní — a priorita řadila jen uvnitř každého z nich, takže kritický dnešní úkol stál pod nízkoprioritním propadlým a seznam odpovídal na „kdy to mělo být", ne na „co teď". **Propadlost pořadí nést nemusí**: na řádku ji říká červené datum a nad seznamem řádka triáže, takže se sloučením žádný signál neztratil. Připnuté zůstávají blokem nahoře schválně — špendlík („Top 3 dne") je ruční „tohle první", tedy jiná osa než priorita; kdyby ho priorita přebila, přestalo by připnutí znamenat cokoli. Při shodné prioritě rozhoduje termín (`sortTasks`), takže se propadlé uvnitř své úrovně dostanou nad dnešní samy. Ověřeno vrácenou vadou: se starým pořadím spadne přesně ten test, který tu vadu popisuje. Fronta triáže je bez připnutých — ty už si člověk na dnešek vybral; „hotovo · N" sbalené na konci seznamu (`useRozbaleno`, rozbalení na výšku přes `DisclosureContent`); dobírá se po 30 řádcích. Přepínač **Priorita / Klient** (jen když dnes pracuješ pro víc klientů, `todo.dnes.razeni`) seskupí tentýž seznam po klientech — nahradil filtr chipů, který stál uprostřed obrazovky. Tip na gesta je jedna tichá věta pod kartou. Audit chování čte propadlé z řádky triáže (`/po termínu[^0-9]*(\d+)/i`) a hotovo z tlačítka `hotovo · N`.
- [x] **Vše = druhá poloha záložky Dnes** (`src/views/VseView.tsx`). Dnes odpovídá na „co teď?" a schválně ukazuje jen dnešek — jenže otázka „kde je ten úkol?" a „co všechno mám rozdělané?" neměla v appce místo: Plán se dívá dopředu po dnech, inbox je jen „bez termínu", hledání chce vědět, co hledáš. **Nová záložka to není**: dok má tři sloty po 64 px a čtvrtý by rozbil soustřednou kapsli i zásadu „jedna obrazovka = jedna odpověď". Je to druhá poloha té stávající — **jedno ťuknutí na Dnes nemění nic, dvojité ukáže všechno**. Gesto je čistá logika s testy (`src/lib/dvojklik.ts`, okno `DVOJKLIK_MS` 320 ms = práh dvojitého ťuknutí v iOS), protože platí pro prst (pointerup v doku, `onReselect` v `DokZalozky`) i pro klávesnici (dvakrát „1" na Macu) a bez jednoho pravidla by se ty dvě cesty rozešly. Počítá se **dvojí ťuknutí na TUTÉŽ záložku, ať už byla vybraná, nebo ne**. Dřív se gesto počítalo jen na už vybrané záložce — z Plánu se tedy muselo ťuknout na Dnes, počkat, a teprve pak ťuknout dvakrát; to po člověku chce, aby věděl, kde zrovna stojí, přitom **ruka umí jedinou věc: dvakrát klepnout na tu ikonu**. První ťuknutí přepne, druhé rozbalí, a mezi nimi není nic k zapamatování. Přepnutí na JINOU záložku počítadlo nuluje samo (`prev.id !== id`), takže rychlé Dnes → Plán → Dnes nespustí nic; po dvojitém se počítadlo nuluje, takže trojité ťuknutí není dvojité dvakrát. **Klávesové zkratky 1–3 jdou proto jednou cestou** — i „2" a „3" musí stisk zapsat, jinak by 1 → 2 → 1 vyšlo jako dvojité ťuknutí na Dnes. Hlídá to audit chování vrácenou vadou (s nulováním při přepnutí spadne „dvojité ťuknutí z jiné záložky"). Nahlédnutí **se nepamatuje**: přepnutí záložky ho vždycky složí (`useEffect` na `tab`), takže se v něm nedá uvíznout a appka nikdy nestartuje v režimu, na který jsi zapomněl. Cesta zpátky je i vidět — chip „‹ Dnes" (`aria-label="Zpět na Dnes"`, aby v dokumentu nebyla dvě tlačítka „Dnes"); na skryté gesto se nespoléhá. **Polohu nese i dok, ne jen titulek obrazovky.** Ikona Dnes má dvě podoby — nejsou to dvě různé ikony: kroužek s fajfkou zůstává a ve druhé poloze se za něj postaví **druhý kroužek** („ne jeden den, ale celá hromádka"). Zadní kroužek je oblouk ukončený **přesně v průsečíku** s předním (r 7,6, středy 10,6 a 14,0 → průsečíky v 12,30 ± 7,41); dokud končil dřív, vypadal jako závorka vedle ikony, ne jako kroužek za ní. Předsazený kroužek je menší než osamocený (r 7,6 vs 9) — tak to dělá i SF Symbols u dvojic `…on…`. Přepnutí se **neděje potichu**: čočka udělá **pulz** (`PULZ_MS` v `DokZalozky`) — zdvih v místě přes `vzlet()`/`dosedni()` a **jeden přejezd odlesku**, který si musí vyrobit vlastní průjezd (`pulzX`/`pulzJas`), protože odlesk za letu tahá rychlost a ta je v místě nula; obojí se slučuje do `leskX`/`leskO`, takže nikdy neběží dvakrát. Nová ikona vyjede zespoda jako při vybrání (`replace.downUp`) a dokreslí se tahem — `DokZalozka` na to má prop `podoba` a `key` na ní, jinak by motion pohyb nepřehrál (`animate` dostává pokaždé týž literál) a ikona by jen tiše probliskla; první vykreslení se schválně nerozjíždí (`prvniPodoba`), dok při startu vyjíždí zespoda celý. **Nic se nedeformuje** — žádné smrsknutí ani natažení, jen zdvih a světlo, stejnou řečí jako let. Změřeno po 8 ms: čočka 1 → 1,072 ve vrcholu, odlesk svítí 314–704 ms (vrchol 0,95), dosedá v 880 ms, tedy zároveň s doběhnutím ikony a podpisu. Obrazovka se k tomu **vytáhne zespoda** (`BlurFade` `direction='up'`) a při návratu se dnešek snese shora (`'down'`, jen při opravdovém návratu z Vše — `zVse`, aby start appky zůstal nájezdem zespoda). V klidovém režimu gesto **pořád přepíná**, jen bez pulzu a bez nájezdu ikony: vypnout se smí pohyb, ne funkce (hlídá audit chování). Obsah: **jen otevřené úkoly** (inbox + aktivní) — hotové jsou historie, patří do sbalené sekce na Dnes a do týdenního ohlédnutí; kdyby se přisypaly sem, byl by z „vše" archiv a číslo v hlavičce by lhalo o tom, kolik práce zbývá, proto to podtitulek říká nahlas. Řazení je **jeden seznam podle priority** (`sortTasks`, pomocné funkce v `src/lib/vseUkoly.ts` s testy). Dřív tu byly časové koše „po termínu / dnes / zítra / tento týden / později / bez termínu" s odůvodněním, že se v třech stech řádcích hledá podle času — jenže na „kde je ten úkol" odpovídá **hledání** (⌘K) a na „kdy to je" celá obrazovka **Plán**, takže koše dělaly potřetí totéž a rozsekaly jediný seznam na šest kousků, z nichž ani jeden nezačínal tím nejdůležitějším. Kdo se dívá na VŠECHNO, co má rozdělané, chce vidět **pořadí práce, ne kalendář**. Z košů zbyly **propadlé, a to ne jako koš, ale jako řádka triáže nad seznamem** — červené číslo a cesta ven po jednom; to je jediná věc, kterou seznam sám vyřešit neumí. Přepínač **Priorita / Klient** (`todo.vse.razeni`; neznámá uložená volba, i staré `'termin'`, padá na prioritu) seskupí tentýž seznam po klientech — a **hlavičku dostávají jen skupiny**, protože jediný seznam nemá co pojmenovat. Dobírá se po 30 řádcích a strop platí na celý seznam, ne na každou skupinu zvlášť (jinak by šest skupin po třiceti bylo sto osmdesát řádků). Audit chování počítá `li.skupina-li`, ne text hlavičky: **prázdné jméno by textovou kontrolou prošlo a řádka by na obrazovce přesto stála** (ověřeno vrácenou vadou). Audit rozhraní měří „Vše" jako plnou obrazovku (vstup přes `dblclick`, hned za Dnes — další obrazovka ji sama složí) a audit chování hlídá všechny čtyři stavy gesta: jedno ťuknutí nic, dvojité otevře, přepnutí složí, pomalé dvojí nespustí. **Pozor na selektory**: Playwright hledá přístupný název jako podřetězec, takže `{ name: 'Dnes' }` chytá i řádek dne v Plánu („dnes · 12 · volno") — v auditech je proto `exact: true`.
- [x] Dnes bez zdi: obrazovka umí ukázat až jedenáct bloků a dohromady na „co teď?" neodpovídaly. Karta „Teď" se schválně nepřidává — připnuté a ranní návrh tou kartou už jsou, další blok by byl dvanáctý. Místo toho: propadlé ukážou napoprvé jen pět řádků (`DlouhySeznam` s `uvod`), zbytek patří do triáže, ne do zdi; „bez termínu" a „hotovo" stojí **sbalené** do řádky s počtem (`SbalenaSekce`), protože to není dnešní práce — číslo říká pravdu, rozbalení je na klepnutí a appka si ho pamatuje (`todo.dnes.rozbaleno`). Audit chování počítá s tím, že odškrtnutý úkol spadne do sbalené sekce, a ověřuje rozbalení i jeho přežití přes reload.
- [x] **Plán = mřížka měsíce a pod ní vybraný den.** Klasický kalendář, jak ho lidé znají (`UpcomingView` + `src/components/MesicniMrizka.tsx`, měsíční aritmetika je čistá logika s testy ve `src/lib/mesic.ts`): sedm sloupců, **týden od pondělí**, listuje se po měsících šipkami. Mřížka odpovídá na „kdy to je", den pod ní na „co to je" — schůzky, úkoly, tiché pole „Nový úkol na sobotu 12. září…" (4. pád, `formatFullDateNa`) a „+ Vybrat z úkolů bez termínu · N". **Tohle je třetí podoba Plánu a druhý návrat mřížky**, tak ať je jasné proč: mřížka tu dvakrát neuspěla (nejdřív čísla s tečkami, pak se sloupky), protože sedm čísel v řádce má na telefonu ~41 px na buňku a jméno klienta ani počet hodin se do ní nevejdou — den pak umí říct jen „něco tam je". Mezitím byl Plán řada dnů jako řádků, kde se pruh i popisek („2 úkoly · 1 schůzka · ~3 h") vešly, ale kalendář to nepřipomínalo. Řeší to **dělba práce**, tak jak ji dělá kalendář v telefonu: buňka nese jen číslo a **pruh dne v barvách klientů** (tedy KOLIK a KOMU), a jména, čas schůzek i jednotlivé úkoly stojí rozepsané pod mřížkou. **Do čísel se nikdy nedává text, na který v nich není místo.** Vizuální řeč je tatáž jako u kalendáříku v zadávání (`MonthPicker`): jediná plná výplň je vybraný den, dnešek má kroužek, minulé dny a víkendy jsou tišší. **Listování bere výběr s sebou** (v měsíci s dneškem na dnešek, jinam na prvního) — kdyby výběr zůstal stát, ukazuje mřížka jeden měsíc a agenda pod ní den z jiného; hlídá to audit chování vrácenou vadou. Zpátky vede vidět tlačítko „dnes", ne jen šipky. Propadlé se počítají na dnešek (Plán se dívá dopředu, triáž je na Dnes) a minulé dny v mřížce zůstávají tiché. Souhrn měsíce vedle jeho jména počítá CELÝ měsíc od dneška, ne jen dny se značkou, takže se listováním nemění; schůzky v něm nejsou — kalendář je stažený jen po konec okna (180 dní, `FETCH_WINDOW_DAYS`; pravidelné úkoly ze šablon 90 dní, `GENERATION_HORIZON_DAYS`). Hlavička nese souhrn tohoto týdne a řádku chipů „Bez termínu · N" a „Týdenní ohlédnutí". **Bez termínu je panel** (`BezTerminuSheet`): z chipu jen k nahlédnutí, z vybraného dne jako výběr — „Sem" pošle úkol na ten den (`dueDate`, `status: 'active'`, toast se „Zpět" vrací do inboxu); fronta se snímá při otevření. Agenda vybraného dne je **seznam na papíře**, ne karta: karta dávala smysl, dokud visela pod řádkem dne a říkala „tohle patří tomu dni" — pod mřížkou je to hlavní seznam obrazovky. Audit chování počítá `main li` v Plánu při 400 úkolech (buňky mřížky plus agenda) a hlídá čtyři věci, které pravítko nezměří: ťuknutí na den přepne agendu, šipka přelistuje měsíc, výběr jde s ním a „dnes" vrátí obojí.
- [x] **Přepsaný termín překoná naplánování** (`src/lib/terminPlan.ts`, čistá funkce s testy). „Kdy to je" je DŘÍVĚJŠÍ z `dueDate` a `scheduledFor` (`denUkolu`) — a naplánování si ve většině případů nenastavuje člověk, razítkuje ho přijatý ranní návrh nebo večerní uzávěrka. Kdo pak v detailu přepsal Termín na pozdější den, viděl úkol pořád na Dnes a **nemohl poznat proč**: slot „Naplánovat na jiný den" stojí na konci vodorovné řádky, takže na úzkém displeji leží za hranou. To, co ho tam drží, na obrazovce prostě nebylo. Změřeno na skutečných datech: termín přepsaný na ne 20. 9., naplánování pořád pá 18. — člověk posunul termín o dva dny a v appce se nezměnilo nic. Ze třinácti otevřených úkolů s naplánováním jich dvanáct nemá žádný termín, takže **ten jediný, co měl obě data, byl přesně ten rozbitý**. Pravidlo: **poslední ruční rozhodnutí vyhrává** — přepíšeš-li Termín a naplánování necháš být, je naplánování překonané a zahodí se. Tři výjimky: (1) člověk s ním v témže panelu sám pohnul (to jsou dvě vědomá rozhodnutí vedle sebe — „termín je neděle, dělat to budu v pátek"), (2) termín se nezměnil, (3) termín se SMAZAL — „tohle nemá deadline" není „tohle je jindy". Zahození, ne srovnání na tentýž den: dvě stejná data na jednom úkolu nic neříkají, a uvolní to i blok v kalendáři stávající cestou (`deleteBlockForTask`). Prázdný řetězec z pole se normalizuje na „nevyplněno", jinak by `'' !== undefined` vypadalo jako ruční změna a pravidlo by se nikdy nespustilo. Hlídá to audit chování celým kruhem přes rozhraní (naplánovat na dnešek → zavřít → přepsat termín na zítřek → úkol musí z Dnes zmizet a nesmí se ztratit); ověřeno vrácenou vadou.
- [x] Jedno datum v detailu úkolu: primární je **Termín** (`dueDate` — to píše parser i rychlé zadávání, pro člověka je to „ten den"), `scheduledFor` je vrstva navrch (ranní návrh, uzávěrka) a v detailu se ukáže jen když je vyplněné nebo si o něj člověk řekne („+ Naplánovat na jiný den"). Data se nemění. Dřív stála dvě data vedle sebe a potřebovala odstavec, který vysvětluje rozdíl — když pole potřebuje odstavec, netrefil ho model, ne uživatel. Vysvětlení zůstalo jen u rozbaleného druhého data.
- [x] Klienti jako přehled stavu: řádek klienta nese jednu stavovou řádku v pořadí důležitosti — kolik hoří („2 po termínu", danger — jen propadlé TERMÍNY) → co se nestihlo z vlastního plánu („1 nestihnuto", note; dřív se počítalo jako „po termínu" a klient svítil červeně jen proto, že jsem si jeho úkol naplánoval na včerejšek) → ticho („ticho 12 dní", note) → kdy je další práce (jen z toho, co teprve přijde; dřív se do „nejbližšího dne" započítal i propadlý termín a četlo se to jako plán) → druh → sdíleno. Pořadí je záměrné kvůli ořezu zprava na 320 px. Ticho bývalo samostatný odznak vpravo — tři prvky vedle sebe (odznak, počet, šipka) ořízly právě „po termínu".
- [x] **Detail klienta = hlavička, chipy, jeden seznam.** Obrazovka dřív skládala pod sebe napojení na Todoist, pole pro úkol, šablony, úkoly, každý projekt jako sekci s trvale viditelným „Uzavřít · Smazat", formulář projektu, hlídání, sdílení a mazání — nastavení mezi polem a seznamem, do kterého úkol padá. Teď: (1) hlavička s tečkou, jménem a **touž stavovou řádkou jako v seznamu** (`src/lib/clientStatus.ts`, čistá funkce `stavKlienta`); (2) řádka chipů (`Chip`): „Upravit" otevírá `KlientSheet` (jméno, barva, druh, pravidelná kontrola, hlídání zanedbání, šablony přepínači, Todoist, sdílení, archivace, smazání — vše se ukládá hned), ostatní chipy (Kontrola, Šablony · N, Todoist · N) jen říkají, co je zapnuté, a vedou tamtéž; (3) tiché pole pro nový úkol, plusko se vynoří až s textem; (4) **jeden seznam na papíře, bez karty**: úkoly bez projektu, pak každý projekt jako skupinová řádka (název, cíl, termín, „1 z 3", šipka) — ťuknutí otevře `ProjektSheet` (název, cíl, termín, uzavřít, smazat; obojí vratné toastem); „hotovo · N" sbalené na konci. Ze šablonových instancí je v detailu jen **nejbližší výskyt** každé položky — reconciler jich generuje na 90 dní dopředu a stejné řádky pod sebou byly šum (zbytek je v Plánu). Audit chování maže klienta přes „Upravit" → „Smazat klienta".
- [x] **Detail úkolu = titulek, poznámka, jedna stavová řádka.** Dřív formulář s osmi popsanými poli v rozbalovátkách; když pole potřebuje popisek a `<select>`, je to nastavení, ne úkol. Název je teď titulek (rostoucí `textarea`, Enter přeskočí do poznámky), poznámka pod ním bez rámečku, odkazy jako čipy, a všechno ostatní nese **stejná řádka slotů jako zadávání v doku** (`SlotChip`, sdílené v `src/components/SlotChip.tsx`): Termín (rychlé dny + `MonthPicker` + čas), Klient, Projekt, Priorita, Opakování, Naplánovat na jiný den. Panel s výběrem se rozbaluje pod řádkou; u úkolu z Todoistu slot Klient/Projekt jen řekne toastem, že zařazení patří Todoistu. **Opakování = frekvence + den**: pravidlo je explicitní (`RuleParts` v `src/lib/rrule.ts`: `partsFromRule`/`ruleFromParts`), u týdenních se volí dny v týdnu (i víc naráz), u měsíčních den v měsíci (mřížka 1–28), u ročních ještě měsíc. Dřív si předvolba brala den z termínu a „každou neděli" znamenalo napřed přesunout termín na neděli. Změna pravidla **srovná termín na první výskyt od dneška** (`alignDueDate`): stávající termín zůstane jen když pravidlo trefuje a ještě nenastal; bez termínu ho úkol dostane, protože respawn po odškrtnutí (`respawnRecurring`) se odvíjí od `dueDate`. Pravidlo mimo předvolby (z parseru, „každé 3 týdny") se nechá být a jen ukáže. **Měsíční a roční pravidlo s dnem v týdnu je taky mimo předvolby** (`FREQ=MONTHLY;BYDAY=1MO`, „každé první pondělí v měsíci"): dřív se tvářilo jako předvolba „měsíčně", `partsFromRule` z něj vzalo pouhé „pondělí", pořadí zahodilo a doplnilo `dom=1` — první uložení detailu ho přepsalo na „každého 1. v měsíci" a úkol se tiše přestal opakovat tehdy, kdy má. Nikde to nebylo vidět, protože popis hlásil holé „měsíčně", což platilo i pro přepsanou verzi; **popis proto musí říct celou pravdu** — „měsíčně (1. pondělí)", „měsíčně (poslední pátek)". Pořadové dny nesou plná jména: „1. po" vypadá jako překlep, kdežto ve výčtu týdenního pravidla „(po, čt)" zkratka sedí dál. Šablony (`RecurrencePicker`) stojí na týchž částech. Checklist je jedna karta s polem pro další krok uvnitř. **Podúkol smí mít termín** (`src/lib/podukoly.ts`, čisté funkce s testy): velký úkol („spustit kampaň") má kroky, které mají svoje dny („podklady do středy"), a dokud šel ten den zapsat leda do názvu kroku, appka o něm nevěděla nic. Termín stojí přímo v řádku kroku — **prázdný jen nabízí** (tichý kalendářík v `ink-faint`), vyplněný ukazuje den, otevřený má pod sebou `VyberDne`, tedy táž řeč jako sloty nahoře, jen zmenšená; naráz je otevřený nejvýš jeden. Ukládá se hned jako zbytek checklistu, ne až tlačítkem. **A hlavně je vidět ZE SEZNAMU**: řádek úkolu nese vedle počtu kroků nejbližší termín nehotového kroku a propadlý je červený (`danger`) — termín, který je vidět jedině po otevření úkolu, appka neuhlídá, a to je přesně ten druh slibu, který tahle appka nedává. **Dnešek propadlý není** (den ještě běží), hotový krok se nepočítá vůbec — udělaná práce se nepřipomíná, takže propadlé datum na odškrtnutém kroku nedrží řádek červený. **Do Plánu se kroky nepřidávají**: den v Plánu odpovídá na „co dnes dělám" a kroky jsou uvnitř práce, ne práce samy; kdyby se sypaly do dnů, počítal by se jeden úkol vícekrát a strop dne (v úkolech!) by přestal měřit to, co měří — kdo potřebuje krok v Plánu, potřebuje úkol. **Nový výskyt opakovaného úkolu termíny kroků ZAHAZUJE** (`krokyProDalsiVyskyt`): „podklady do 5." u zářijového reportu neplatí pro říjnový a posunout to appka neumí (o kolik? o měsíc? o tolik, o kolik se posunul úkol?) — ponechaný termín by z každého nového výskytu udělal hromadu propadlých kroků hned při založení, tedy červenou, kterou nikdo nezpůsobil. **U kroku z Todoistu vlastní termín Todoist**, stejně jako termín celého úkolu: stažení ho přebírá (`deadline` před `due`, jako u úkolu) a ťuknutí to řekne toastem místo tiché změny, kterou by další stažení přepsalo. Hlídá to audit chování (oddíl 17, osm kontrol ověřených vrácenou vadou: termín držený jen ve stavu panelu shodí dvě, neviditelný na řádku tři, ponechaný termín při respawnu shodí dva unit testy). **Pozor na kontroly, které čtou datum ze skutečné obrazovky**: `formatDayLabel` píše u blízkých dnů slova („Včera", „Zítra"), takže kontrola na tvar „24. 9." by hlásila planý poplach přesně tehdy, kdy na termínu nejvíc záleží — čte se proto skrytá věta „termín podúkolu", ne tvar data. A v otevřeném detailu jsou **dvě tlačítka „Dnes"** (slot Termín úkolu a rychlý den v kalendáříku kroku), takže audit klikne do mřížky dne — jinak by nastavil termín ÚKOLU a prošel by i s rozbitým termínem kroku. Ukládá se tlačítkem a ⌘↩; checklist, špendlík a „kdo úkol vidí" hned. Audit chování plní `#pole-ukol` (teď `textarea`).
- [x] Triáž propadlých (`TriageSheet`): sekce „po termínu" umí narůst do stovek (změřeno 134 na roční hromádce) a jako seznam je to slepá ulička. Nadpis je proto akce — průchod po jednom se **žebříkem dnů**: Dnes → Zítra → Volnější den → Už neplatí, a oba odkladové dny nesou pod sebou konkrétní datum („ne 13. 9."), takže je vidět, kam to půjde. Dřív tu stálo jediné „Příští týden (pondělí)" — jedno tlačítko, jedno datum, takže sto propadlých úkolů skončilo na témž pondělí; to je tatáž zeď, jen o týden dál. „Volnější den" je nejbližší pracovní den s nejmenší zátěží do **sedmi dnů** (`src/lib/volnyDen.ts`, strop je úmyslný — odložit o měsíc není odložení) a počítá se **živě**: každý odložený úkol tam přibude, takže další stisk najde jiný den a hromádka se rozprostře (změřeno: tři stisky po sobě daly st 16., čt 17., pá 18.). Souhrn na konci vypisuje jen odpovědi s nenulovým počtem. Fronta se snímá při otevření, jinak by živý dotaz pod rukama přerovnával pořadí. Termín se posouvá stejně jako všude jinde (`scheduledFor`, a když ho úkol nemá, `dueDate`) — pevný termín se nikdy nepřepisuje potichu. „Už neplatí" nastaví `status: 'dropped'`, ne tombstone: úkol zmizí z otevřených seznamů, ale zahozená práce zůstane v datech. „Zpět" vrací i to. Tlačítko dole vlevo je **„Přeskočit"**, ne „Nechat být": není to odpověď — úkol nechá propadlý a jen posune frontu na další. „Nechat být" znělo jako rozhodnutí („tenhle už řešit nebudu"), tedy skoro jako „Už neplatí" o dvě řádky výš, a nešlo je od sebe poznat; sloveso říká přesně ten mechanismus a tvoří dvojici se „Zpět" vedle.
- [x] Fáze 7 — týdenní zpětná vazba (`src/lib/weekReview.ts`, čisté funkce): nedělní/pondělní karta na Dnes otevírá `WeeklyReviewSheet` — hotové úkoly a rozpad podle klientů, plán vs. realita, nejodkládanější úkoly, tiší klienti, výhled na 7 dní. Porovnání odhadu a skutečnosti času **nepřibude** — odhady byly zrušené (viz Fáze 5). Místo hodin je v ohlédnutí osobní průtok v úkolech, tedy číslo, které appka opravdu naměřila. Až bude Fáze 6 (push), nedělní notifikace má vést sem.
- [x] Fáze 8 — Todoist: sdílené projekty klientů a jejich úkoly do appky. API token žije na serveru (`public.todoist_tokens`, RLS bez policies, write-only RPC `store_todoist_token`), do Todoistu sahá jen edge funkce `todoist` (projects/pull/close/reopen). Mapování polí je čistá logika (`src/lib/todoistMap.ts`), srovnání s lokální DB taky (`src/db/todoistImport.ts`) — projekt → klient (párování na `Client.todoistProjectIds`; za cizí se bere `is_shared || workspace_id`, jinak by týmové projekty nešly napojit), sekce → projekt, `deadline` → `dueDate`, `due` → `scheduledFor`, podúkoly → checklist (odškrtnutí kroku zavře podúkol i tam, nový krok tam vznikne, vlastní kroky stažení přežijí); lokální id deterministicky z todoistího. Todoist vlastní název, prioritu a termín; naplánování dne, odhad a špendlík zůstávají naše, poznámku a checklist si bere jen když je sám má. Zpátky letí odškrtnutí, znovuotevření, úpravy (`todoistDirty` = neodeslaná změna, stažení ji nepřepíše) a — po zapnutí u klienta (`todoistPushSince`) — i nové úkoly. Zamčené je jen zařazení. Opakovaný úkol se v Todoistu odškrtnutím posouvá, ne zavírá: nový termín se bere jako nový výskyt, hotový spadne do lokální historie (jinak by druhý `close` posunul úkol podruhé). Do appky chodí **jen úkoly, na kterých je uživatel označený**
  (`isMine`) — i z projektů, které nejsou spárované s klientem (server je
  dotáhne filtrem `assigned to: me`); takové přijdou bez klienta do inboxu
  a zařazení pod klienta jim stažení nesebere, úklid se o ně opře jen když
  projde i dotaz na hotové (`assignedProjects`). Nepřiřazené ani cizí úkoly
  se neberou a když úkol přiřazení ztratí, zmizí. Výjimky: úkol odeslaný
  z appky (Todoist ho přes API zakládá bez přiřazení — značka
  `Task.todoistFromApp`, jinak by si ho appka sama smazala) a podúkoly
  mého úkolu (jsou to položky checklistu). Bez `myUid` se neuklízí nic. Komentáře u úkolu bydlí v `Task.todoistComments` (offline i na druhém zařízení) a odpovídat jde z detailu; nové hlídá přírůstek přes `/sync` s uloženým `sync_token` (jedno volání za stažení) a cizí komentář rozsvítí `todoistUnread` na řádku úkolu. Podrobně v **`docs/TODOIST.md`** — zbývá spustit SQL a nasadit edge funkci
- [x] **Přihlášení na jedno tlačítko a pozvánky** (`supabase/pozvanky.sql`). Dvě věci stály v cestě tomu, aby se appka dala vůbec začít používat ve dvou. (1) **Registrace měla čtyři kroky a jeden z nich byla omluva**: vymysli si heslo, najdi potvrzovací e-mail, klikni na odkaz — a appka sama hlásila, že „stránka po kliknutí může hlásit chybu, to nevadí" — vrať se a přihlas se. Odkaz je navíc na iPhonu past: otevře se v Safari, ne v appce na ploše, takže se člověk přihlásí jinam, než kde chtěl. Teď je to **e-mail, heslo, jedno tlačítko** (`signIn` v engine.ts): zkusí se přihlášení, a když účet ještě není, rovnou se založí. Rozdíl mezi „přihlásit se" a „vytvořit účet" je pro hrstku lidí, co se znají, rozdíl bez obsahu — a přesto se z něj muselo trefit správné tlačítko. **Pořadí je schválně přihlášení první**, jinak by každý návrat začínal chybou „účet už existuje". **Špatné heslo se pozná až z druhého pokusu**: server úmyslně neprozradí, jestli e-mail existuje, takže `already registered` u zakládání znamená „účet je, jen heslo nesedí" — bez téhle větve by se člověku s překlepem ukázalo „účet už existuje", což je pravda, která mu nepomůže. **Žádný e-mail se neposílá**; předpokladem je vypnuté potvrzování (Supabase → Authentication → Sign In / Providers → Email → Confirm email). Když je zapnuté, `signUp` nevrátí session a appka to **řekne nahlas** místo tichého nic. Google zůstává jako druhá cesta, protože jím se zároveň propojí kalendář. (2) **Sdílení nešlo ZAČÍT, jen dokončit**: `share_client` odmítal e-mail bez účtu („ať se nejdřív zaregistruje"), takže se kamarád měl zaregistrovat do appky, kde do té doby neuvidí nic, a zvoucí si měl pamatovat, že se má vrátit. Teď se pozvánka uloží k e-mailu (tabulka `invites`, RLS bez policies — jinak by šlo z appky vyčíst, koho kdo zve) a při prvním přihlášení se sama promění ve sdílení (`claim_invites`, volá se po přihlášení a pak nejvýš jednou za minutu). `list_client_shares` vrací i nevyzvednuté pozvánky s příznakem `pending`, takže zvoucí vidí „čeká na první přihlášení" — a odvolat pozvánku jde stejně snadno jako ji poslat, jinak by překlep v e-mailu zůstal viset a při registraci toho člověka by se probudil. **Kdo co vidí, rozhoduje dál RLS** a nezměnilo se: `user_id = auth.uid()` (všechno, co jsem založil) NEBO řádek patří sdílenému klientovi.
- [x] Fáze 9 — sdílení klienta s dalším uživatelem (`supabase/shares.sql`). Jednotka sdílení je **klient**: co pod ním visí (projekty, úkoly), je sdílené taky — s jednou výjimkou po úkolech: `Task.hiddenFrom` je seznam id lidí, kterým se TENHLE úkol neukazuje (u společného klienta se dělá i práce, do které kolegovi nic není). Hlídá to policy, ne UI — filtr v appce by řádek pořád posílal do cizího zařízení. Zakladatele klienta vyjmout nejde: majitele řádku pouští RLS vždycky, takže by odškrtnutí u jeho úkolu jen lhalo. Kdo je vyjmutý, na řádek nedosáhne, takže se sám vrátit nemůže; jeho lokální kopii uklidí `sweepVanished` (u sdílejících proto běží po půlhodině, ne jednou za den — o zmizelý řádek se kurzorový pull nedozví). Úkoly bez klienta zůstávají soukromé, stejně jako šablony a denní plány. Nestaví se druhý synchronizační kanál — jen se **rozšíří RLS** (policy `vlastni a sdilene` porovnává `data->>'clientId'` proti `shared_client_ids()`), takže sdílené řádky natečou stávající cestou pull → Dexie → UI a odškrtnutí se vrací zpátky přes LWW úplně stejně jako mezi dvěma zařízeními jednoho člověka. Správa přes security-definer RPC (`share_client`/`unshare_client`/`list_client_shares`/`my_shares`), klient na tabulku `shares` přímo nedosáhne. Dvě věci, které se dají snadno rozbít: (1) kurzorový pull na změnu rozsahu sám nereaguje — nově zpřístupněné řádky mají staré `updated_at`, takže se při změně otisku sdílení nulují pull kurzory (`ensureShareScope`, čistá logika v `src/sync/shareState.ts`); (2) úklid po odebraném sdílení musí být **tvrdý lokální výmaz, nikdy tombstone** — ten by se odsynchronizoval zpátky a smazal data majiteli. Zjišťování sdílení, které selže, se bere jako „nevím" (ne jako „nic nesdílím"), jinak by výpadek sítě spustil mazání. Vlastnictví řádku hlídá `lww_guard`, který při každé úpravě vrátí původní `user_id`. Přepnutí účtu na jednom zařízení teď lokální data maže — bez toho by je plný push nahrál do cizího účtu. Odesílání i úklid stojí na evidenci odeslaných verzí (`pushState`, čistá logika v `src/sync/outbox.ts`): (a) posílá se, co se od evidované verze liší — časový kurzor ztrácel změny pokaždé, když stažené razítko z druhého zařízení (hodiny napřed) posunulo kurzor nad čas následujících lokálních zápisů; (b) záznam odmítnutý serverem se izoluje, zbytek dávky projde a počet se hlásí do `SyncStatus.refused` — jedna nešťastná úprava nesmí umlčet odesílání napořád, a proto se u JEDINÉHO odmítnutého záznamu v dávce schválně nevyhazuje chyba; (c) `sweepVanished` jednou denně — u sdílejících po půlhodině — a při změně rozsahu sdílení zahodí lokální kopie toho, co server nezná — kurzorový pull se o zúžení rozsahu nedozví. Úklid nikdy nesahá na neodeslanou práci a přeskočí tabulku, jejíž seznam ze serveru nedošel celý; půlka seznamu vypadá jako „zbytek zmizel". Před zapomenutím klienta se napřed odešle, co čeká — jinak by o offline založené úkoly přišel ten, komu sdílení právě vzali.
- [x] **Fáze 11 — den má strop a appka to řekne včas** (`src/lib/kapacitaDne.ts` a `src/lib/prutok.ts`, čisté funkce s testy). Přetížený den uměla appka poznat odjakživa, jenže **jen na obrazovce Dnes** — tedy v den, kdy už se s tím nedá nic dělat. Ve chvíli, kdy se práce na budoucí den SYPE, mlčela úplně. Změřeno na dvanácti dnech skutečného provozu: čtvrtek se **sedmi úkoly dal jedno odškrtnutí**, pátek se čtyřmi nula, čtvrtek předtím se třemi nula — zatímco **obě soboty, na které se neplánovalo nic, daly po dvou**. Dny, které se naplní, jsou přesně ty, co spadnou; sedm úkolů z toho čtvrtka tam navíc leželo i o tři dny později. **MĚŘÍ SE V ÚKOLECH, NE V MINUTÁCH.** První verze stála na odhadech času a byl to písek: `estimateMinutes` není měřený, ale HÁDANÝ — razítkuje ho heuristika o osmi klíčových slovech (`estimate.ts`), a co se netrefí, nedostane odhad vůbec. Změřeno na 45 úkolech provozu: **24 z nich (53 %) odhad nemá** a tiše se za ně počítá 60 minut, zbytek má jen dvě hodnoty (11× 30 min, 10× 90 min). Tedy polovina konstanta, polovina hod mincí mezi dvěma čísly — a s realitou se to nikdy neporovná, protože appka čas neměří a měřit nezačne (stopky v todo appce jsou práce navíc, kterou nikdo nedělá). Ten nález, kvůli kterému strop vznikl, přitom žádné minuty nepotřebuje: **ten příběh vypráví POČET, a počet je fakt**. **Strop je OSOBNÍ, ne nominální** (`osobniPrutok`/`stropZPrutoku`): okno 30 dní, počítají se úkoly dokončené v jednotlivých dnech a bere se z nich **dobrý den** (`PERCENTIL` 0,8). **Ne medián** — strop na obvyklém dni by se ozval skoro pokaždé a signál, který svítí pořád, přestane být signál. Na skutečných datech (17 dnů, ve kterých se něco dokončilo) vychází **medián 2 úkoly za den, nejlepší den vůbec 3**, tedy strop 2; s tolerancí jednoho úkolu (`TOLERANCE_UKOLU`) se appka ozve **od čtyř úkolů na den** — spustí se na tom čtvrtku (7) i na pátku (4) a mlčí na dni se třemi. **Počítají se jen dny, ve kterých se něco dokončilo**: den bez odškrtnutí není den s nulovým průtokem, ale nejspíš den, kdy se appka neotevřela, a nuly by strop stáhly k zemi za každý volný týden. Počítá se jen z MOJÍ práce (`mojeUkoly`): u sdíleného klienta odškrtává i kolega. **Pod `MIN_DNU` (7) se nehlídá NIC** — appka si o novém člověku nic nevymýšlí. Dřív se v té situaci sahalo po pracovní době, tedy po osmi hodinách, jenže to nebyla znalost, jen náhradní číslo, které se tvářilo jako znalost: nejlepší den za celý provoz měl 150 minut, takže nominální strop byl **víc než trojnásobek životního rekordu** — strážce, který se nemá jak ozvat. **Číslo drží jeden hook** (`useOsobniStrop`) a berou si ho Plán i Dnes — kdyby si ho každá obrazovka počítala po svém, byl by plný den na jedné jinde než na druhé. **Appka nezakazuje, jen řekne a uhne**: úkol na plný den opravdu jde a zůstane tam, dokud s ním člověk sám nepohne; toast řekne výsledek („st 23. 9. má 4 úkoly · obvykle 2") a nabídne **Jinam**, což je TÝŽ volnější den, jaký volí triáž propadlých i ranní návrh (`volnejsiDen`) — hledá se od DALŠÍHO dne, protože ten vybraný je plný a jinak by se vrátil sám. Platí to na obou místech, kde se práce vědomě sype na den: pole „Nový úkol na…" v Plánu a „Sem" v panelu Bez termínu (tam toast nese **obě** cesty — „Jinam" i „Zpět", protože zrušit se musí dát i krok, po kterém appka něco namítla, jinak by z upozornění byla past). Počítá se nálož obrazovky PLUS ten právě založený úkol: živý dotaz o něm ještě neví a čekat na překreslení by znamenalo hlásit strop o úkol později, tedy zase pozdě. **Volnější den se vybírá taky podle počtu** (`src/lib/volnyDen.ts`), jinak by appka poslala úkol na den, který sama hlásí jako přeplněný: čtyři krátké úkoly vyjdou v minutách líp (4 × 30) než jeden dlouhý se schůzkou (60 + 120), ale strop překročí právě ty čtyři. V tom součtu měl navíc hlavní slovo ten hádaný díl — jediný úkol bez odhadu vážil přesně tolik co hodinová schůzka. Délka schůzek je jediné MĚŘENÉ číslo, které tu je, takže se nezahodila: rozhoduje při shodě počtu úkolů. **V mřížce to nese ČÍSLO dne, ne pruh** (`note-ink`, polotučně): pruh se přes svůj základ natáhnout nemůže, takže den se čtyřmi a den s deseti úkoly kreslí v buňce totéž — plno; a mřížka je přitom jediné místo, kde se den vybírá. Pruh sám dnes měří **v týchž úkolech a proti témuž stropu** (viz „Pruh dne je jazyk appky“), takže si s verdiktem neprotiřečí — jen neumí říct o kolik. Výběr a dnešek zůstávají nad tím: kde zrovna stojím, je vždycky důležitější než jak je tam nabito. Toast bere krátký popisek dne (`formatDayLabel`, „so 12. 9."), ne „sobota 12. září" — má `max-w-48` a delší věta se v něm ořízne. **Barva čísla se čte proti TOKENU, ne proti jinému dni** — srovnání „plný den vs nějaký jiný" je planá kontrola: kdyby se tón nekreslil vůbec, vyšel by plný den jako `ink` a ten druhý jako víkendový `ink-soft`, tedy dvě různé barvy a kontrola projde, i když signál není. **A hlavně: to číslo je vidět** — týdenní ohlédnutí říká „za den uděláš obvykle 2 úkoly, v nejlepší den 3 (z 12 dnů práce), Plán se proto ozve, až jich na jeden den naplánuješ víc než 3". Bez téhle věty je strop číslo, které nikde nestojí, a takovému se nedá věřit; patří do ohlédnutí, ne na Dnes — je to číslo k zamyšlení, ne k popohánění. **Strop musí být v závislostech `useMemo`**, který z něj počítá značky do mřížky — přichází z živého dotazu, takže se po prvním vykreslení objeví, a bez něj by mřížka zůstala u verdiktu, který padl dřív, než appka toho člověka znala. (Závislost je správná z principu, ale audit ji nedokazuje: ten závod se v něm spolehlivě netrefí, takže se na něj nelze spolehnout jako na pojistku.) Hlídá to audit chování (oddíl 15, deset kontrol ověřených vrácenou vadou: mlčící strop shodí čtyři, věčně křičící tři, vypuštěný tón čísla jednu a mřížka kreslená proti jinému základu než pruh pod ní taky jednu — 0,50 proti 1,00; a oddíl 16, dvě kontroly: týž den se čtyřmi úkoly projde bez historie a s osmi dny historie je přeplněný — strop počítaný z minut místo z kusů shodí čtyři z nich). **Odhady času tím z appky odešly ÚPLNĚ**: `estimate.ts` i `capacity.ts` jsou smazané, `addTask`, reconciler šablon ani stažení z Todoistu už nic nerazrítkují a věty typu „~4 h" zmizely z Plánu i z Dneška. Zbyla jediná minuta, a ta je měřená: délka bloku v kalendáři bere `duration` z Todoistu, a když není, je to hodina.
- [x] **Fáze 10 — práce v týmu: kdo to má udělat** (`src/lib/tymUkoly.ts`, čisté funkce s testy). Sdílení z Fáze 9 umělo jednu věc: OBA VIDÍ TOTÉŽ. To je viditelnost, ne týmová práce, a rozbíjelo to appku na třech místech: (1) **nikdo nic nevlastnil** — dva lidé koukali na týž seznam a ani jeden nevěděl, co z toho je na něm, takže se buď oba spoléhali na toho druhého, nebo dělali totéž dvakrát; (2) **Dnes se plnilo cizí prací** — `openTasks()` vrací všechno, na co appka dosáhne, takže kolegův úkol spadl do mého dneška, do počtu propadlých i do kroužku postupu, a ten kroužek tím začal lhát: den nešel dodělat, protože půlka nebyla moje; (3) **osobní vrstvy byly společné** — `scheduledFor`, `pinnedFor` a `postponeCount` odpovídají na „kdy to udělám JÁ" a seděly na sdíleném řádku, tedy jedno políčko pro dva lidi (kolega si úkol připnul do svých Top 3 a připnul ho tím i mně). Všechno tři řeší jediný údaj, KDO TO MÁ — a to třetí mimochodem: jakmile má úkol v každé chvíli právě jednoho člověka, má osobní vrstvu kdo vyplnit a nikdo jiný jí nesahá, takže se **druhá, per-uživatelská vrstva dat stavět nemusí**.
  **Čí to je se ODVOZUJE, neukládá** (`jeMuj`, `kdoMa`): `assignedTo` (komu to bylo dané) přebíjí `ownerId` (kdo úkol založil) a bez obojího je úkol můj. Kdyby se ukládalo, musel by se při zavedení projít celý archiv a každému úkolu někoho dopsat — a komu u člověka, který nic nesdílí? Takhle to vychází správně samo: kdo nic nesdílí, má všechno svoje; kdo klienta právě nasdílel, si svoje úkoly nechá; kolegovy jsou od začátku kolegovy; a čerstvě založený úkol, který ještě neodešel na server, je můj, i když razítko nemá. **Nepřihlášený má všechno svoje** — bez téhle větve by se odhlášené appce vyprázdnil dnešek.
  **`ownerId` je razítko ze serveru, ne obsah úkolu**: doplňuje ho `applyPull` ze sloupce `user_id` (jediné místo, kde je vlastnictví pravda — hlídá ho trigger `lww_guard`) a při odesílání se zase odstraní, aby v `data` nevznikla druhá, tišší pravda o vlastnictví. Dvě věci, které se tu dají rozbít: (1) razítko se musí doplnit i řádkům, které server nenese jako novější — jinak by je kurzorový pull nikdy nepřinesl a po upgradu by **všechny cizí úkoly vypadaly jako moje**; proto `ensureOwnerStamp` jednou vynuluje pull kurzory; (2) doplnění razítka **nesmí přepsat novější lokální úpravu** — v té větvi se zapisuje lokální záznam s razítkem, ne serverový (ověřeno vrácenou vadou: se serverovým spadne přesně ten test).
  **Dnes a Plán ukazují moje, Vše a detail klienta všechno.** Je to dělba podle otázky: Dnes a Plán odpovídají na „co mám dělat já" (pruh dne je moje zátěž, ne součet práce týmu), Vše na „kde je ten úkol" a detail klienta na „jak na tom klient je" — kdyby cizí úkoly schovaly, nebylo by je kde najít. Čí co je, říká **jméno u řádku** (`kdoMaJmeno` v `TaskRow`) a vyplňuje se **jen když to nejsem já**: kdo pracuje sám, tuhle značku nikdy neuvidí. **Triáž propadlých je taky jen moje** — posouvá termíny a přeložit kolegovi termín z mojí obrazovky je zásah do jeho práce. Ve Vše přibyla **třetí poloha přepínače „Kdo"** (já první, ostatní podle jména), nabízí se jen tomu, kdo něco sdílí; uložená volba se po zrušení sdílení sama vrátí na „Termín", jinak by zůstal přepínač ve stavu, který se nemá kde přepnout zpátky.
  **Předání je slot „Kdo to má"** v detailu úkolu (jen u sdíleného klienta) a ukládá se hned, ne tlačítkem — kdyby čekalo na Uložit, zavřel by člověk panel s pocitem, že úkol předal, a nepředal. Přiřazení **škrtne toho člověka z `hiddenFrom`**: přiřadit práci někomu, kdo na ni nevidí, je úkol, o kterém neví nikdo. Volba shodná se zakladatelem se ukládá jako prázdno — je to výchozí stav, ne rozhodnutí. Nový výskyt opakovaného úkolu si **nese přiřazení dál** („ten měsíční report dělá Jana" platí i pro příští měsíc), ale razítko majitele zahazuje — je to nový řádek a orazítkuje ho až ten, kdo ho odešle.
  **Odškrtnutí má jméno** (`completedBy`): `completedAt` říká kdy, tohle kdo — u sdíleného klienta je „hotovo" bez jména informace jen z poloviny; ukazuje se stejně jen tehdy, když to nejsem já.
  **Jména se dohledávají, nesynchronizují** (`src/sync/lide.ts`, tabulka `lide`): ve sdílených datech se nosí id (e-mail by ve sdíleném řádku přečetl každý, kdo na něj dosáhne), ale „u-8f3c…" na řádku nikomu nic neřekne. Cache v Dexie drží jméno i offline a **nikdy se nemaže** — u úkolu po odejitém kolegovi je to jediná cesta, jak ukázat „jana" místo „někdo další". Zkracuje se na první část před tečkou, ale jen dokud je jednoznačná (`kratkaJmena`): dvě Jany vedle sebe jsou přesně ta vada, kvůli které ta funkce existuje. Kdo nic nesdílí, nestojí to ani jeden dotaz.
  **Zavislé přiřazení se uklízí** (`zavislaPrirazeni`): kolegovi skončí sdílení, na jeho zařízení se úkoly smažou, u mě ale zůstanou přiřazené jemu — takový úkol nemá nikoho (z mého dneška vypadl, do jeho se nedostane) a propadl by mezi dvěma lidmi potichu. Úklid běží v `lide.ts`, protože tam appka právě s jistotou ví, kdo u kterého klienta je; **při jakémkoli selhání dotazu se vůbec nespustí** — půlka mapy vypadá jako „zbytek nikdo nesdílí" a smazala by platná přiřazení. Vlastní přiřazení neruší nikdy.
  **Server ctí totéž pravidlo**: ranní návrh (`morning-plan`) bral úkoly podle `user_id`, takže by nabízel práci, kterou jsem předal, a zamlčel tu, kterou jsem dostal — tedy přesně opačně, než jak vypadá appka v ruce. Teď filtruje `assignedTo` a dotahuje i klienty cizích úkolů (bez nich by v odůvodnění chyběl klient, což je u cizí práce ta důležitější půlka věty). **Schéma se nemění**: přiřazení je informace O práci, ne další právo — kdyby rozhodovalo o přístupu, znamenalo by předání úkolu i tichou změnu toho, kdo na klienta vidí. `supabase/tym.sql` je proto jediná věc, částečný index pro ten ranní dotaz.

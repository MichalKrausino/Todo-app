# Chytrý Todo + kalendář pro Michala

Technický plán a rozvaha — verze 1, 29. 7. 2026

---

## Shrnutí na jeden odstavec

Stavíme osobní systém pro marketéra, který řídí práci pro několik klientů. Není to obecný todo-list, je to nástroj, který ví, kteří klienti existují, jaké pravidelné kontroly u nich musí proběhnout, kolik času reálně zbývá v Google kalendáři, a každé ráno navrhne pár konkrétních věcí k udělání, které se jedním klepnutím přijmou nebo zamítnou. Poběží jako webová appka nainstalovaná na ploše iPhonu i MacBooku, funguje offline, synchronizuje se sama, nestojí nic navíc a nikdy nevyprší.

---

## Proč webová appka a ne nativní iOS

Tohle rozhodnutí padlo po zjištění tvrdého faktu o Applu. Bez placeného Apple Developer Programu za 99 USD ročně nejsou dostupné iCloud a CloudKit, App Groups, push notifikace ani widgety, a navíc podpis zdarma platí jen sedm dní, po kterých appka přestane jít spustit a musí se znovu nahrát z Xcode. To znamená, že nativní cesta zdarma by zabila přesně tři věci, které jsi označil za nezbytné: propojení iPhonu s MacBookem, ranní notifikaci a spolehlivý každodenní běh.

Webová appka přidaná na plochu tyhle věci umí. Na iPhonu funguje jako plnohodnotná ikona bez adresního řádku, umí web push notifikace (od iOS 16.4, s podmínkou že je nainstalovaná na ploše — Apple to sice v roce 2024 chtěl v EU zrušit, ale rozhodnutí obrátil a v Česku to funguje normálně), funguje offline díky service workeru a lokální databázi, a na MacBooku je to ta samá appka bez jediného řádku kódu navíc. Mac tedy dostáváš zadarmo hned, ne až jako druhou fázi.

Cena za to jsou dvě věci. Widget na ploše na iOS webová appka mít nemůže — tohle jsi odsouhlasil, ranní notifikace ti stačí. A jazykový model nemůže běžet přímo v iPhonu přes Apple Foundation Models, takže chytré funkce potřebují síť. To ale nevadí tolik, jak se zdá, protože ranní návrh dne stejně musí počítat server, jak vysvětluju níž.

Když se to za rok osvědčí a budeš chtít widget a on-device AI, přechod na nativní appku je pak snadný: datový model, logika plánování i všechna tvoje data zůstávají tvoje a přenositelná.

---

## Jak to bude fungovat z tvého pohledu

Ráno v sedm ti přijde notifikace. Klepneš na ni a otevře se ti obrazovka s třemi až šesti návrhy — u každého jedna věta proč zrovna tohle. „Kontrola kampaně pro Klienta X, naposled ses na to díval před devíti dny." „Návrh landing page pro Klienta Y, deadline je pozítří a dnes máš tři hodiny v kuse volno." U každého návrhu buď palec nahoru, čímž se úkol propíše do dneška a zabere si blok v Google kalendáři, nebo palec dolů, čímž zmizí a appka si to zapamatuje.

Během dne zadáváš nové věci jedním polem. Napíšeš „ve čtvrtek poslat report Klientovi X" a appka z toho udělá úkol s termínem, přiřazeným klientem a odhadem času, který nikde nevidíš a nezadáváš — používá se jen k tomu, aby ti řekla, že se den nevejde. Když je odhad vedle, jen posuneš blok a systém se z toho poučí.

V neděli večer přijde krátké shrnutí týdne. Co jsi opakovaně odkládal, u kterých klientů se dlouho nic nedělo, kolik z naplánovaného se skutečně stalo.

---

## Struktura dat

Nejvyšší úroveň je klient, který zároveň slouží jako oblast — vedle skutečných klientů tam budou i oblasti typu „Interní" nebo „Osobní", které se chovají stejně. Pod klientem jsou projekty s konkrétním cílem a pod nimi úkoly. Úkol může viset i přímo pod klientem bez projektu, což je typické pro pravidelné kontroly.

```
Client (= oblast)
  id, name, color, kind: client | internal | personal
  status: active | paused | archived
  notes
  checkIntervalDays        // po kolika dnech bez aktivity varovat
  lastActivityAt           // dopočítáváno z úkolů
  templateIds[]            // nasazené šablony

Project
  id, clientId, name, goal, status, dueDate, order

Task
  id, clientId, projectId?
  title, notes
  priority: low | normal | high | critical
  dueDate?                 // dokdy to musí být
  scheduledFor?            // na kdy jsem si to naplánoval
  calendarEventId?         // blok v Google kalendáři
  status: inbox | active | done | dropped
  estimateMinutes?         // tichý odhad od AI, neukazuje se jako pole
  actualMinutes?           // měřeno z rozdílu plán vs. dokončení
  recurrenceRule?          // iCal RRULE
  sourceTemplateItemId?
  completedAt?, order

Template                   // balíček pravidelných úkolů, např. „Správa PPC"
  id, name
  items[]: { title, recurrenceRule, priority, defaultProjectName? }

DayPlan                    // co appka navrhla a jak jsem reagoval
  id, date
  suggestions[]: { taskId, reason, decision: accepted | rejected | ignored }

// Každý záznam navíc: createdAt, updatedAt, deletedAt (tombstone kvůli synchronizaci)
```

Šablony jsou ta část, která řeší tvoji největší bolest. Nový klient dostane šablonu „Správa PPC" a tím se mu automaticky založí týdenní kontrola kampaní, měsíční report, čtvrtletní vyhodnocení strategie. Když šablonu později upravíš, změna se propíše ke všem klientům, kteří ji mají nasazenou.

---

## Technický stack

```
Frontend      React + TypeScript + Vite + Tailwind
PWA           vite-plugin-pwa (Workbox) — service worker, offline, instalace na plochu
Lokální data  IndexedDB přes Dexie.js — zdroj pravdy je lokální, ne server
Backend       Supabase (Postgres + Auth + Edge Functions + pg_cron), free tier
Přihlášení    Supabase Auth přes Google — zároveň získá přístup ke kalendáři
Kalendář      Google Calendar API v3
Notifikace    Web Push (VAPID) ze Supabase Edge Function
AI            cloudové API volané přes Edge Function (klíč nikdy v prohlížeči)
Hosting       Vercel nebo Cloudflare Pages, HTTPS zdarma
```

Klíčové rozhodnutí je offline-first: appka čte a zapisuje výhradně do IndexedDB a nikdy nečeká na síť. Synchronizace běží na pozadí jako samostatná vrstva, která posílá změny nahoru a stahuje cizí změny dolů. Protože jsi jediný uživatel a na dvou zařízeních nepracuješ současně, stačí jednoduché řešení konfliktů typu „vyhrává poslední zápis" podle `updatedAt`. Mazání se řeší tombstony, ne skutečným smazáním, jinak by se smazané záznamy vracely z druhého zařízení.

---

## Napojení na Google kalendář

Přihlášení přes Google zároveň vyžádá oprávnění ke kalendáři, takže se nepřihlašuješ dvakrát. Appka čte všechny tvoje kalendáře, aby věděla, kdy jsi obsazený, ale zapisuje výhradně do vlastního kalendáře jménem „Todo", který si v Google kalendáři můžeš kdykoliv jedním kliknutím schovat, aniž bys přišel o schůzky. Naplánované bloky tak vidíš i mimo appku, na hodinkách a kdekoliv jinde.

Události z kalendáře se cachují do IndexedDB, takže i offline appka ví, kdy máš schůzky. Zápisy vzniklé offline se zařadí do fronty a odešlou při první příležitosti.

Refresh tokeny od Googlu musí být uložené na serveru, ne v prohlížeči — jednak kvůli bezpečnosti, jednak proto, že server potřebuje do kalendáře vidět i v době, kdy máš appku zavřenou.

---

## Chytrá vrstva

Rozdělíme ji na tři úrovně podle toho, kolik inteligence která věc potřebuje.

Rychlé zadávání funguje offline bez modelu. Napíšeš „ve čtvrtek poslat report @klientx !vysoká" a jednoduchý parser v prohlížeči rozpozná datum, klienta i prioritu. Zvládne české tvary jako zítra, v pátek, za tři dny, příští týden, 15.9. Když parser něco nepochopí, úkol se založí tak jak je a doplní se, až bude síť.

Odhady času a rozpadání projektů jdou do cloudu. Odhad se počítá tiše na pozadí při vzniku úkolu a nikde se neptá. Rozpadání spustíš vědomě tlačítkem u projektu — napíšeš „postavit web pro Klienta X" a dostaneš návrh konkrétních kroků, které buď přijmeš celé, nebo po jednom.

Ranní návrh dne počítá server, ne telefon. To je důležité: iOS webovým appkám nepovoluje běh na pozadí, takže kdyby plán počítal prohlížeč, nikdy by se nespustil dřív, než appku otevřeš — a pak by ta notifikace byla k ničemu. Naplánovaná úloha na Supabase se tedy v sedm ráno probudí, načte tvoje úkoly a volný čas v kalendáři, seřadí kandidáty podle termínu, priority, zanedbanosti klienta a dostupného času, nechá model vybrat tři až šest a napsat u každého jednu větu odůvodnění, uloží to jako DayPlan a odešle push notifikaci.

Skórování kandidátů je čistá logika, ne model — model jen vybírá z předtříděného seznamu a formuluje. To je levnější, rychlejší a hlavně předvídatelnější.

---

## Postup po fázích

**Fáze 1 — kostra, kterou už jde používat.** Projekt, instalace na plochu iPhonu, lokální databáze, klienti a projekty a úkoly, rychlé zadávání, dnešní seznam, odškrtávání. Zatím bez syncu a bez AI, data jen v telefonu. Cílem je, aby se to dalo otevřít a fungovalo to offline. Reálně jeden až dva večery.

**Fáze 2 — dvě zařízení.** Přihlášení přes Google, Supabase schéma, synchronizační vrstva s tombstony, ověření na iPhonu i MacBooku. Od téhle chvíle je appka na Macu zadarmo hotová. Zhruba jeden víkend.

**Fáze 3 — kalendář.** Čtení schůzek z Google kalendáře, výpočet volných oken, zápis naplánovaných bloků do vlastního kalendáře „Todo". Jeden až dva večery.

**Fáze 4 — klienti pořádně.** Šablony pravidelných úkolů, opakování podle RRULE, generování instancí dopředu, hlídání zanedbaných klientů. Tohle je funkčně nejcennější část celého projektu. Jeden víkend.

**Fáze 5 — chytré funkce.** Proxy na model přes Edge Function, tiché odhady času, rozpadání projektů na kroky, chytřejší parsování zadání. Jeden až dva večery.

**Fáze 6 — ranní návrh.** Push notifikace, naplánovaná úloha v sedm ráno, obrazovka s návrhy a tlačítky přijmout/zamítnout, učení z odmítnutí. Jeden víkend.

**Fáze 7 — týdenní zpětná vazba.** Nedělní shrnutí, statistiky odkládání, přehled zanedbaných klientů, porovnání odhadu a skutečnosti.

Po fázi 4 už máš nástroj, který dělá věci, které dnešní appky neumí. Fáze 5 až 7 jsou ta chytrá nadstavba, kvůli které do toho jdeš, ale nemá smysl je stavět dřív, než ti základ spolehlivě šlape.

---

## Co může zlobit

Push notifikace na iOS fungují jen u appky přidané na plochu. Je to jednorázový krok, ale musíš ho udělat ručně přes tlačítko sdílení v Safari, jinak se notifikace nikdy nepřihlásí.

iOS webovým appkám nepovoluje synchronizaci na pozadí. Prakticky to znamená, že se data srovnají vždy až při otevření appky. Pro jednoho uživatele na dvou zařízeních to nevadí, ale je dobré to vědět.

Lokální úložiště může Safari při nedostatku místa vyčistit. Řešíme to tím, že si vyžádáme trvalé úložiště přes `navigator.storage.persist()` a hlavně tím, že server je vždycky záloha — smazaná cache znamená jen nové stažení, ne ztrátu dat.

Poslední věc je disciplína u opakujících se úkolů. Šablony jsou mocné, ale když si nasadíš patnáct pravidelných kontrol na pět klientů, vytvoříš si přesně ten zahlcený seznam, před kterým utíkáš. Doporučuju začít se dvěma nebo třemi kontrolami na klienta a přidávat, až budeš vědět, které skutečně děláš.

---

## Náklady

Hosting zdarma, Supabase na free tieru zdarma, Google Calendar API zdarma. Doména je volitelná, adresa typu `neco.vercel.app` funguje úplně stejně včetně notifikací. Jediná položka je volání jazykového modelu, které při tvém objemu vyjde na jednotky dolarů měsíčně. Apple nedostane nic.

---

## Jak na tom pracovat

Tahle konverzace běží v cloudu, takže odsud se dá psát kód a plán, ale ne spouštět vývojový server a testovat v prohlížeči. Na samotné stavění chceš Claude Code v terminálu na MacBooku. Cyklus je pak jednoduchý: `npm run dev`, testuješ v Safari na Macu, a na iPhonu si to otevřeš přes lokální síť. Jakmile bude první nasazení na Vercel, testuješ přímo na telefonu z ikony na ploše.

Ještě než začneš psát kód, doporučuju v repozitáři založit soubor `CLAUDE.md` s rozhodnutími z tohohle dokumentu — datový model, offline-first pravidlo, zákaz volání sítě z komponent, zápis jen do kalendáře „Todo". Claude Code si ho načte při každém spuštění a nebudeš mu tyhle věci opakovat.

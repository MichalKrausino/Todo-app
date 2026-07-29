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

## Co už umí (Fáze 1)

- Klienti/oblasti → projekty → úkoly, vše offline v IndexedDB (Dexie)
- Rychlé zadávání s českým parserem: „ve čtvrtek poslat report @klient !vysoká“,
  „za 3 dny“, „příští týden“, „15.9.“ — funguje i bez diakritiky
- Obrazovky **Dnes** (po termínu / dnes / hotovo), **Plán** (podle dnů + bez
  termínu) a **Klienti** (detail, projekty, archivace)
- Instalace na plochu, offline režim přes service worker

## Stack

React + TypeScript + Vite + Tailwind, PWA přes `vite-plugin-pwa`, lokální data
Dexie.js (IndexedDB). V dalších fázích Supabase (sync, push, cron) a Google
Calendar API — viz plán.

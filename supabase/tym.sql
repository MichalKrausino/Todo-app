-- Fáze 10: práce v týmu — přiřazení úkolu konkrétnímu člověku.
-- Spusť jednou v Supabase → SQL Editor (navazuje na schema.sql a shares.sql).
--
-- SCHÉMA SE NEMĚNÍ. „Kdo to má udělat" je `data->>'assignedTo'` uvnitř
-- úkolu, takže se přenáší stávající cestou a stávajícími policies: komu
-- se úkol smí ukázat, rozhoduje dál sdílení klienta (a výjimka
-- `hiddenFrom`). Přiřazení je informace O práci, ne další právo — a kdyby
-- rozhodovalo o přístupu, znamenalo by předání úkolu i tichou změnu toho,
-- kdo na klienta vidí.
--
-- Tenhle soubor je proto jediná věc: index. Bez něj ho appka nepotřebuje
-- ke správné funkci, jen k rychlé.

-- Ranní návrh dne (edge funkce `morning-plan`) se každé ráno ptá za každého
-- přihlášeného člověka: „co je přiřazené mně?" Je to dotaz do JSONB napříč
-- všemi úkoly všech účtů (běží pod service role, tedy mimo RLS), takže bez
-- indexu je to pokaždé průchod celou tabulkou.
--
-- Index je ČÁSTEČNÝ: přiřazení má zlomek úkolů (kdo pracuje sám, nemá
-- přiřazený ani jeden), takže plný index by z devadesáti procent nesl
-- prázdno. Tenhle drží jen řádky, na které se kdy někdo zeptá.
create index if not exists tasks_assigned_idx
  on public.tasks ((data->>'assignedTo'))
  where data->>'assignedTo' is not null;

-- Poznámka k úklidu, ať je jasné, kde se řeší: úkol přiřazený člověku,
-- kterému mezitím skončilo sdílení, by nepatřil nikomu — z mého dneška
-- vypadne (patří jinam) a do jeho se nedostane (nevidí ho). Neřeší se to
-- tady triggerem, ale v appce (`zavislaPrirazeni` v src/lib/tymUkoly.ts),
-- protože jen ta ví, čí je které zařízení, a protože zápis musí projít
-- přes `updatedAt` — jinak by ho druhé zařízení podle LWW vrátilo zpátky.

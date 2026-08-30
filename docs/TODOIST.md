# Fáze 8 — napojení Todoistu

Cíl: klienti, kteří mě přidali do svých projektů v Todoistu, a jejich úkoly
se objeví v této appce jako normální klienti a úkoly — vidím je na Dnes,
v Plánu, počítají se do kapacity, chodí na ně upozornění.

Tenhle dokument je průzkum, návrh a zároveň návod k nasazení. Kód v appce
je hotový — zbývá spustit SQL a nasadit edge funkci (sekce 7).

---

## 1. Co Todoist API umí (ověřeno)

Todoist v roce 2025 sloučil staré REST v2 a Sync v9 do jediného **API v1**.

- **Základ:** `https://api.todoist.com/api/v1/`
- **Autorizace:** hlavička `Authorization: Bearer <token>`
- **Formát na drátě:** snake_case (`is_shared`, `responsible_uid`, `next_cursor`)
- **Stránkování:** odpovědi jsou `{ "results": [...], "next_cursor": "..." }`,
  posílá se zpět jako `?cursor=`
- **Limity:** 1000 požadavků / 15 minut na token. My budeme dělat jednotky
  požadavků každých 10+ minut — do limitu se vejdeme s obrovskou rezervou.

### Endpointy, které potřebujeme

| Co | Volání |
| --- | --- |
| seznam projektů (včetně sdílených) | `GET /api/v1/projects` |
| spolupracovníci projektu | `GET /api/v1/projects/{id}/collaborators` |
| aktivní úkoly | `GET /api/v1/tasks?project_id=…` |
| úkoly přes filtr | `GET /api/v1/tasks/filter?query=…` |
| hotové úkoly | `GET /api/v1/tasks/completed/by_completion_date?since=…&until=…` |
| sekce | `GET /api/v1/sections?project_id=…` |
| dokončit úkol | `POST /api/v1/tasks/{id}/close` |
| inkrementální sync | `POST /api/v1/sync` (`sync_token`, `resource_types`) |

### Tvary objektů (podle oficiálního TypeScript klienta Doist)

**Projekt:** `id`, `name`, `color`, `parent_id`, `is_shared`, `is_archived`,
`is_favorite`, `is_deleted`, `description`, `child_order`, `view_style`,
`can_assign_tasks`, `updated_at`. U týmových projektů navíc `workspace_id`, `role`.

**Úkol:** `id`, `project_id`, `section_id`, `parent_id`, `content` (název),
`description` (poznámka), `due` (`{ date, datetime?, string, is_recurring, timezone? }`),
`deadline` (`{ date }`), `duration` (`{ amount, unit }`), `priority` (1–4),
`labels[]`, `responsible_uid` (komu je přiřazený), `added_by_uid`,
`assigned_by_uid`, `checked`, `is_deleted`, `completed_at`, `updated_at`.

**Spolupracovník:** `id`, `name`, `email`.

### Sdílené projekty = klienti

Když mě klient přidá do svého projektu, ten projekt **normálně vyskočí v mém
`GET /projects`** s `is_shared: true`. Nemusím nic zvlášť vyžadovat.
Spolupracovníky (kdo v projektu je, včetně e-mailů) vrátí
`/projects/{id}/collaborators`. To je přesně to, o co jde.

---

## 2. Co je potřeba udělat na tvojí straně

1. **Token.** Todoist → Nastavení → Integrace → **Vývojář** → zkopírovat
   „API token". Funguje na jakémkoli tarifu, tvoje Pro předplatné navíc není
   podmínkou toho, aby tě klienti přidali (limit spolupracovníků řeší tarif
   vlastníka projektu). Token nikam neposílej — vkládá se přímo v appce.
   - Pozor: osobní token má **plný přístup k celému účtu** a nedá se omezit.
     Proto poletí rovnou na server (viz níže) a nikdy nebude v prohlížeči.
     Kdykoli ho zneplatníš tamtéž ve vývojářském nastavení.
   - Alternativa je OAuth s vlastní aplikací (dá se omezit rozsah), ale pro
     osobní appku je to zbytečná režie navíc — token stačí.
2. **Nasadit** edge funkci `todoist` a spustit SQL migraci (stejný postup jako
   u `reminders`, pošlu přesné kroky).
3. **Spárovat** v appce: v nastavení se objeví seznam sdílených projektů
   z Todoistu a u každého vyberu, kterému klientovi odpovídá (nebo „založit
   nového klienta").

---

## 3. Kam patří token (architektura)

Podle pravidel v `CLAUDE.md` (bod 1, 4, 5) klient nikdy nedrží cizí klíče a
nikdy nevolá cizí síť přímo. Todoist sice posílá CORS hlavičky a šlo by na něj
sáhnout přímo z prohlížeče, ale znamenalo by to mít plný token účtu v
localStorage telefonu. Takže stejný vzor jako Google kalendář:

```
prohlížeč ──RPC store_todoist_token()──► public.todoist_tokens   (RLS bez policies)
prohlížeč ──POST /functions/v1/todoist──► edge funkce ──Bearer──► api.todoist.com
```

**SQL (nové):**

```sql
create table if not exists public.todoist_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  api_token text not null,
  sync_token text,                 -- kurzor pro inkrementální sync (později)
  updated_at timestamptz not null default now()
);
alter table public.todoist_tokens enable row level security;  -- bez policies

create or replace function public.store_todoist_token(token text)
returns void language sql security definer set search_path = '' as $$
  insert into public.todoist_tokens (user_id, api_token, updated_at)
  values (auth.uid(), token, now())
  on conflict (user_id) do update
    set api_token = excluded.api_token, updated_at = now();
$$;
revoke all on function public.store_todoist_token(text) from public, anon;
grant execute on function public.store_todoist_token(text) to authenticated;
```

**Edge funkce `todoist`** (`POST {action, …}`, stejné CORS a JWT jako `calendar`):

| akce | co dělá |
| --- | --- |
| `projects` | vrátí projekty + spolupracovníky pro párovací obrazovku |
| `pull` | stáhne úkoly namapovaných projektů + hotové od poslední synchronizace |
| `close` | označí úkol v Todoistu za hotový |

**Klientská vrstva `src/sync/todoist.ts`** — jediné místo appky, které o
Todoistu ví. Volá ji engine po doběhnutí syncu a při návratu do popředí
(úplně stejně jako `src/sync/calendar.ts`), zapisuje výhradně přes `repo`.

---

## 4. Mapování dat

### Projekt → klient

Jeden sdílený projekt v Todoistu = jeden klient v appce. Párování je ruční
(a uložené), protože klient „Alza" se v Todoistu může jmenovat „Alza — web
2026". Jeden klient smí mít i víc projektů.

### Sekce → projekt

Sekce uvnitř Todoist projektu se stanou projekty pod klientem. Když projekt
sekce nemá, úkoly visí rovnou pod klientem — datový model to umí.

### Úkol → úkol

| Todoist | appka |
| --- | --- |
| `content` | `title` |
| `description` | `notes` |
| `deadline.date` | `dueDate` |
| `due.date` (když je i deadline) | `scheduledFor` |
| `due.date` (když deadline není) | `dueDate` |
| `due.datetime` | `dueTime` (převedený do pražského času) |
| `priority` 4/3/2/1 | `critical` / `high` / `normal` / `low` |
| `duration` (minuty) | `estimateMinutes` |
| `checked`, `completed_at` | `status: 'done'`, `completedAt` |
| `is_deleted`, zmizení | tombstone / `dropped` |
| podúkoly (`parent_id`) | `subtasks[]` (checklist v úkolu) |
| `labels[]` | zatím ignorovat |

Todoistí `deadline` (tvrdý termín) a `due` (kdy se tím budu zabývat) sedí
na náš rozdíl `dueDate` × `scheduledFor` skoro jedna ku jedné — to je
příjemné překvapení.

### Identita a duplicity

Lokální `id` se odvodí deterministicky z Todoist id (`deterministicId`,
stejný trik jako u šablon ve Fázi 4). Obě zařízení tak vyrobí tentýž
záznam, náš vlastní sync ho slije přes LWW a nevzniknou dvojáky.

Nová pole: `Task.todoistId`, `Task.todoistProjectId`, `Task.todoistUpdatedAt`
a `Client.todoistProjectIds[]`.

### Opakování

Opakované úkoly zůstávají v režii Todoistu. Importovaný opakovaný úkol se
označí jako externí, aby ho `completeTask` znovu nezaložil — jinak by se
množil z obou stran.

---

## 5. Kudy tečou změny

**Todoist → appka** (hlavní směr, každých ~10 minut a při otevření appky):

- nový úkol v projektu klienta → objeví se v appce
- změna termínu/priority/textu → přepíše se v appce
- hotovo v Todoistu → hotovo v appce
- úkol zmizel → dohledá se v hotových; jinak `dropped`

**Appka → Todoist** (jen jedna věc):

- dokončím úkol v appce → `POST /tasks/{id}/close`, klient vidí hotovo

Zbytek zůstává lokální: naplánování na den (`scheduledFor`), špendlík Top 3,
odhad času, kalendářní blok, podklady pro ranní návrh. Todoist je pro
importované úkoly zdrojem pravdy u názvu, termínu a priority — ruční přepis
v appce by další synchronizace přepsala, takže tahle pole u importovaných
úkolů zamknu a řádek dostane odznak „Todoist".

---

## 6. Co je rozhodnuté

- **Tahají se jen sdílené projekty.** Vlastní todoistí projekty zůstávají
  stranou — to, co si vedu sám, patří rovnou do appky. Párovací obrazovka
  je ukáže jen jako počet, aby bylo jasné, že se ignorují.
- **Berou se úkoly přiřazené mně a nepřiřazené.** Cizí přiřazené úkoly ve
  sdíleném projektu nechávám být (`isMine` v `src/lib/todoistMap.ts`).
- **Sekce se stávají projekty** pod klientem.
- **Webhooky zatím ne.** Šly by (`item:added`, `item:completed`, `project:*` …)
  a změny by chodily okamžitě, ale vyžadují registraci OAuth aplikace
  v Todoist App Console. Deset minut zpoždění zatím stačí; kdyby vadilo,
  přidají se později.
- **Komentáře** u úkolů (`/comments`) se ignorují.

## 7. Nasazení

Appka je hotová, server ještě ne. Postup:

**Krok 1 — SQL.** V Supabase → SQL Editor spusť poslední sekci souboru
[`supabase/schema.sql`](../supabase/schema.sql) („Fáze 8: Todoist").
Vytvoří tabulku `todoist_tokens` (RLS bez policies) a tři funkce:
`store_todoist_token`, `forget_todoist_token`, `has_todoist_token`.

**Krok 2 — edge funkce.** V Supabase → Edge Functions vytvoř funkci
`todoist` a vlož obsah [`supabase/functions/todoist/index.ts`](../supabase/functions/todoist/index.ts).
Nechat **verify_jwt zapnuté** — volá ji přihlášený klient.

**Krok 3 — token.** V appce: obláček vpravo nahoře → **Todoist** → vložit
API token → Propojit.

**Krok 4 — párování.** Ve stejném panelu se objeví sdílené projekty.
U každého vyber klienta (nebo „založit klienta"). Stahování se rozjede samo
pár vteřin po výběru, jinak tlačítkem „Stáhnout teď".

## 8. Co je v kódu

| Soubor | Co dělá |
| --- | --- |
| `supabase/schema.sql` | tabulka `todoist_tokens` + RPC pro uložení/zapomenutí/ověření |
| `supabase/functions/todoist/index.ts` | brána do API: `projects`, `pull`, `close`, `reopen` |
| `src/lib/todoistMap.ts` | čisté mapování polí (termíny, priorita, checklist) |
| `src/db/todoistImport.ts` | srovnání s lokální DB — co založit, změnit, zavřít, zahodit |
| `src/sync/todoist.ts` | síť, throttle (10 min), stav pro UI |
| `src/components/TodoistSheet.tsx` | vložení tokenu a párování projektů s klienty |

Testy: `src/lib/todoistMap.test.ts` (13) a `src/db/todoistImport.test.ts` (15)
nad fake IndexedDB — pokrývají založení, změnu, checklist z podúkolů,
odškrtnutí oběma směry, mazání a to, že import nepřepíše moje naplánování,
poznámky ani odhad.

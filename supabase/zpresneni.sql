-- ---------------------------------------------------------------------------
-- Zpřesnění zadání modelem (Fáze 5) — fronta pro rutinu Claude Code.
--
-- Model běží na PŘEDPLATNÉM, ne přes placené API: naplánovaná rutina
-- Claude Code (claude.ai/code/routines, „Todo — zpřesnění zadání") se
-- jednou za hodinu přes Supabase konektor zeptá `zpresneni_vezmi`, co
-- čeká, sama napíše návrhy a uloží je přes `zpresneni_hotovo`. Appka si
-- hotové návrhy přečte z tabulky `zpresneni_navrhy` (RLS: jen svoje) a vyčistí
-- je toutéž funkcí jako dřív (`ocisti` v src/lib/zpresneniNavrh.ts).
-- Žádný API klíč nikde neleží.
--
-- Fronta se nikam nezapisuje zvlášť: co čeká, je přímo vidět na úkolech
-- (`tasks.data->'zadani'`, synchronizuje se běžnou cestou). Řádek
-- v `zpresneni_navrhy` vznikne až ve chvíli, kdy si úkol rutina vezme.
--
-- Spouští se v SQL editoru, celé najednou, a je idempotentní.
-- ---------------------------------------------------------------------------

-- Dřívější podoba byla mezipaměť edge funkce `zpresneni` (klíč = otisk
-- vstupu, model přes placené API). Nikdy se do ní nic nezapsalo — bez API
-- klíče funkce končila dřív — a nic ji už nečte. Zůstává prázdná; smazat
-- ji jde ručně (`drop table public.zpresneni;`), tenhle skript na ni
-- nesahá. Návrhy od rutiny bydlí v nové tabulce.

create table if not exists public.zpresneni_navrhy (
  task_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Zadání, ke kterému návrh patří. Když se na úkolu změní, návrh neplatí
  -- a úkol jde do fronty znovu.
  text text not null,
  -- Co dostal model, i s id: parser a kontext v pořadí, ze kterého jsou
  -- krátké odkazy (k1 = první klient…). Appka podle toho odkazy přeloží.
  vstup jsonb not null,
  -- Syrová odpověď modelu (odkazy k1/p2/l1). Čistí ji appka.
  odpoved jsonb,
  stav text not null default 'prace' check (stav in ('prace', 'hotovo')),
  pokusy int not null default 0,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists zpresneni_kdo on public.zpresneni_navrhy (user_id, created_at);

alter table public.zpresneni_navrhy enable row level security;

-- Číst smí jen majitel úkolu a jen hotové. Zapisuje výhradně rutina
-- přes security-definer funkce níž.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'zpresneni_navrhy' and policyname = 'vlastni navrhy'
  ) then
    create policy "vlastni navrhy" on public.zpresneni_navrhy
      for select to authenticated
      using (user_id = (select auth.uid()) and stav = 'hotovo');
  end if;
end $$;

revoke all on public.zpresneni_navrhy from anon, authenticated;
grant select on public.zpresneni_navrhy to authenticated;

-- ---------------------------------------------------------------------------
-- zpresneni_vezmi(n) — rutina si vezme nejvýš n úkolů.
--
-- Vrací pole hotových podkladů pro model: text, co vytáhl parser,
-- a seznamy klientů / projektů / lidí s krátkými odkazy. Kontext je
-- tentýž, jaký vidí appka majitele úkolu (vlastní + sdílené klienty,
-- jeho projekty, lidé u sdílených klientů).
--
-- „dnes" je den, kdy úkol VZNIKL (v Praze), ne den zpracování: rutina
-- jede po hodině a úkol zapsaný ve 22:30 se zpracuje až ráno — „zítra"
-- by se jinak spočítalo od špatného dne.
--
-- Vzatý úkol je 30 minut zamčený; když běh rutiny spadne, vezme ho další
-- (nejvýš třikrát). Denní strop na člověka hlídá, aby chyba v appce
-- nevyčerpala limit předplatného.
-- ---------------------------------------------------------------------------
create or replace function public.zpresneni_vezmi(p_n integer default 5)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  dny constant text[] := array['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
  strop constant int := 50;
  t record;
  u uuid;
  den date;
  klienti jsonb;
  projekty jsonb;
  lide jsonb;
  z jsonb;
  ref_klienta text;
  ref_projektu text;
  vystup jsonb := '[]'::jsonb;
begin
  for t in
    select tk.id, tk.user_id, tk.data
    from public.tasks tk
    left join public.zpresneni_navrhy zp on zp.task_id = tk.id
    where tk.deleted_at is null
      and tk.data ? 'zadani'
      and tk.data->>'status' in ('active', 'inbox')
      and coalesce(tk.data->>'todoistId', '') = ''
      and coalesce(tk.data->'zadani'->>'text', '') <> ''
      and (
        zp.task_id is null
        or zp.text is distinct from tk.data->'zadani'->>'text'
        or (zp.stav = 'prace' and zp.claimed_at < now() - interval '30 minutes' and zp.pokusy < 3)
      )
      and (
        select count(*) from public.zpresneni_navrhy d
        where d.user_id = tk.user_id and d.updated_at > now() - interval '1 day'
      ) < strop
    order by tk.updated_at
    limit greatest(1, least(coalesce(p_n, 5), 10))
  loop
    u := t.user_id;
    z := t.data->'zadani';
    den := coalesce(
      ((t.data->>'createdAt')::timestamptz at time zone 'Europe/Prague')::date,
      (now() at time zone 'Europe/Prague')::date
    );

    -- Klienti, které majitel úkolu vidí — v pořadí podle jména, odkaz = pořadí.
    select coalesce(jsonb_agg(jsonb_build_object('id', c.id::text, 'jmeno', left(c.data->>'name', 80)) order by c.data->>'name', c.id), '[]'::jsonb)
      into klienti
    from (
      select c.* from public.clients c
      where c.deleted_at is null
        and coalesce(c.data->>'status', '') <> 'archived'
        and coalesce(c.data->>'name', '') <> ''
        and (c.user_id = u or c.id in (
          select s.client_id from public.shares s where s.owner_id = u or s.member_id = u))
      order by c.data->>'name', c.id
      limit 200
    ) c;

    select coalesce(jsonb_agg(jsonb_build_object(
             'id', p.id::text, 'jmeno', left(p.data->>'name', 80), 'klientId', p.data->>'clientId'
           ) order by p.data->>'name', p.id), '[]'::jsonb)
      into projekty
    from (
      select p.* from public.projects p
      where p.deleted_at is null
        and p.data->>'status' = 'active'
        and coalesce(p.data->>'name', '') <> ''
        and (p.data->>'clientId') in (select k->>'id' from jsonb_array_elements(klienti) k)
        and (p.user_id = u or coalesce(p.data->'sharedWith', '[]'::jsonb) ? u::text)
      order by p.data->>'name', p.id
      limit 400
    ) p;

    -- Lidé u sdílených klientů (bez majitele úkolu). Jméno je část
    -- e-mailu před zavináčem — totéž, co appka ukazuje u řádku.
    select coalesce(jsonb_agg(jsonb_build_object('id', l.id::text, 'jmeno', l.jmeno) order by l.jmeno), '[]'::jsonb)
      into lide
    from (
      select distinct au.id, left(split_part(au.email, '@', 1), 80) as jmeno
      from public.shares s
      join auth.users au on au.id in (s.owner_id, s.member_id)
      where (s.owner_id = u or s.member_id = u) and au.id <> u and au.email is not null
      limit 50
    ) l;

    select 'k' || i into ref_klienta
      from jsonb_array_elements(klienti) with ordinality as x(k, i)
      where k->>'id' = z->'zaklad'->>'clientId';
    select 'p' || i into ref_projektu
      from jsonb_array_elements(projekty) with ordinality as x(p, i)
      where p->>'id' = z->'zaklad'->>'projectId';

    insert into public.zpresneni_navrhy as zp (task_id, user_id, text, vstup, odpoved, stav, pokusy, claimed_at, updated_at)
    values (
      t.id, u, z->>'text',
      jsonb_build_object(
        'parser', jsonb_strip_nulls(jsonb_build_object(
          'nazev', coalesce(z->'zaklad'->>'title', ''),
          'klientId', z->'zaklad'->>'clientId',
          'projektId', z->'zaklad'->>'projectId',
          'termin', z->'zaklad'->>'dueDate',
          'cas', z->'zaklad'->>'dueTime',
          'priorita', z->'zaklad'->>'priority')),
        'kontext', jsonb_build_object('dnes', den::text, 'klienti', klienti, 'projekty', projekty, 'lide', lide)),
      null, 'prace', 1, now(), now()
    )
    on conflict (task_id) do update set
      text = excluded.text,
      vstup = excluded.vstup,
      odpoved = null,
      stav = 'prace',
      pokusy = case when zp.text = excluded.text then zp.pokusy + 1 else 1 end,
      claimed_at = now(),
      updated_at = now();

    vystup := vystup || jsonb_build_array(jsonb_build_object(
      'id', t.id::text,
      'dnes', den::text,
      'den', dny[extract(dow from den)::int + 1],
      'text', left(z->>'text', 600),
      'parser', jsonb_build_object(
        'nazev', coalesce(z->'zaklad'->>'title', ''),
        'klient', ref_klienta,
        'projekt', ref_projektu,
        'termin', z->'zaklad'->>'dueDate',
        'cas', z->'zaklad'->>'dueTime',
        'priorita', z->'zaklad'->>'priority'),
      'klienti', (select coalesce(jsonb_agg(jsonb_build_object('ref', 'k' || i, 'jmeno', k->>'jmeno') order by i), '[]'::jsonb)
                  from jsonb_array_elements(klienti) with ordinality as x(k, i)),
      'projekty', (select coalesce(jsonb_agg(jsonb_build_object(
                     'ref', 'p' || i, 'jmeno', p->>'jmeno',
                     'klient', (select 'k' || j from jsonb_array_elements(klienti) with ordinality as y(k, j)
                                where k->>'id' = p->>'klientId')) order by i), '[]'::jsonb)
                   from jsonb_array_elements(projekty) with ordinality as x(p, i)),
      'lide', (select coalesce(jsonb_agg(jsonb_build_object('ref', 'l' || i, 'jmeno', l->>'jmeno') order by i), '[]'::jsonb)
               from jsonb_array_elements(lide) with ordinality as x(l, i))
    ));
    ref_klienta := null;
    ref_projektu := null;
  end loop;
  return vystup;
end;
$$;

-- ---------------------------------------------------------------------------
-- zpresneni_hotovo(id, odpoved) — rutina uloží návrh.
--
-- Bere jen známá pole a omezenou velikost; obsah ověřuje appka
-- (`ocisti`): neplatný odkaz, termín v minulosti nebo projekt cizího
-- klienta zahodí jen to jedno pole. Prázdný návrh se ukládá taky —
-- „model k tomu nic nemá" je odpověď a ptát se znovu by byla práce navíc.
-- ---------------------------------------------------------------------------
create or replace function public.zpresneni_hotovo(p_id text, p_odpoved jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  cista jsonb;
begin
  if jsonb_typeof(p_odpoved) is distinct from 'object' or pg_column_size(p_odpoved) > 8000 then
    cista := '{}'::jsonb;
  else
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into cista
    from jsonb_each(p_odpoved)
    where key in ('nazev', 'klient', 'projekt', 'termin', 'cas', 'priorita', 'komu', 'kroky');
  end if;

  update public.zpresneni_navrhy
  set odpoved = cista, stav = 'hotovo', updated_at = now()
  where task_id::text = p_id and stav = 'prace';
  if not found then return 'neznámý nebo už vyřízený úkol'; end if;
  return 'zapsáno';
end;
$$;

revoke all on function public.zpresneni_vezmi(integer) from public, anon, authenticated;
revoke all on function public.zpresneni_hotovo(text, jsonb) from public, anon, authenticated;
grant execute on function public.zpresneni_vezmi(integer) to service_role;
grant execute on function public.zpresneni_hotovo(text, jsonb) to service_role;

-- Úklid (pg_cron: naplánování pod týmž jménem nahradí dřívější úlohu,
-- která uklízela starou mezipaměť): řádek, jehož úkol už zadání nemá (přijato, zahozeno, smazáno,
-- hotovo), nemá cenu. Úkol, který na odpověď pořád čeká, se nemaže —
-- jinak by ho rutina zpracovala znovu.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('zpresneni-uklid', '17 3 * * *', $q$
      delete from public.zpresneni_navrhy z
      where not exists (
        select 1 from public.tasks t
        where t.id = z.task_id and t.deleted_at is null and t.data ? 'zadani'
          and t.data->>'status' in ('active', 'inbox'))
    $q$);
  end if;
end $$;

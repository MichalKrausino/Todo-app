-- Fáze 9: sdílení klienta s dalším uživatelem.
-- Spusť jednou v Supabase → SQL Editor (navazuje na schema.sql).
--
-- Jednotka sdílení je KLIENT: co visí pod sdíleným klientem (projekty,
-- úkoly), je sdílené taky. Úkoly bez klienta (inbox) zůstávají soukromé.
--
-- Jedna výjimka je po úkolech: u konkrétního úkolu jde vypnout, že ho vidí
-- konkrétní člověk (`data->'hiddenFrom'`) — u klienta se dělá i práce, do
-- které kolegovi nic není. Rozhoduje o tom policy, ne appka.
--
-- Sdílení se nedělá druhým synchronizačním kanálem, ale rozšířením RLS:
-- appka stahuje všechno, na co jí server dá právo, takže jakmile řádek
-- projde policy, nateče do druhé appky stávající cestou (pull → Dexie →
-- UI). Odškrtnutí se vrací stejnou cestou zpět, konflikt řeší LWW podle
-- updated_at úplně stejně jako mezi dvěma zařízeními jednoho člověka.

-- ---------------------------------------------------------------------------
-- Vlastnictví řádku se úpravou nemění
-- ---------------------------------------------------------------------------

-- Doplněk k lww_guard ze schema.sql. Dokud platilo „vidím jen svoje", nemohl
-- user_id nikdo cizí přepsat. Se sdílením už na řádek dosáhne i partner, a
-- policy neumí hlídat jednotlivé sloupce — mohl by si tedy zvenčí (mimo
-- appku, ta user_id nikdy neposílá) přepsat majitele na sebe. Trigger to
-- řeší tím, že při KAŽDÉ úpravě vrátí původního majitele zpátky.
create or replace function public.lww_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.updated_at <= old.updated_at then
    return null; -- starší zápis prohrává, upsert projde bez chyby
  end if;
  new.user_id := old.user_id; -- majitele nemění ani sdílení
  return new;
end;
$$;

create table if not exists public.shares (
  client_id uuid not null references public.clients (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  member_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (client_id, member_id)
);

create index if not exists shares_member_idx on public.shares (member_id);
create index if not exists shares_owner_idx on public.shares (owner_id);

-- RLS zapnuté BEZ policies = klient na tabulku přímo nedosáhne.
-- Všechno jde přes security definer funkce níž, které samy hlídají,
-- že volající je majitel (nebo dotčený člen).
alter table public.shares enable row level security;

-- ---------------------------------------------------------------------------
-- Které klienty vidím kvůli sdílení (jako majitel i jako člen)
-- ---------------------------------------------------------------------------

-- Vrací text, ne uuid: policies porovnávají s data->>'clientId', což je text.
-- Tímhle se nikdy nedostaneme k přetypování, které by mohlo spadnout na
-- prázdném nebo chybějícím clientId.
--
-- security definer = čte public.shares mimo její RLS (ta žádnou policy nemá),
-- takže se policies nezacyklí. Funkce nikdy nevrátí nic, co nepatří k
-- auth.uid(), takže tím nic neuniká.
create or replace function public.shared_client_ids()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select s.client_id::text
  from public.shares s
  where s.member_id = (select auth.uid())
     or s.owner_id = (select auth.uid())
$$;

revoke all on function public.shared_client_ids() from public, anon;
grant execute on function public.shared_client_ids() to authenticated;

-- ---------------------------------------------------------------------------
-- Rozšířené policies: vlastní řádky + řádky sdílených klientů
-- ---------------------------------------------------------------------------

-- Klienti se poznají podle vlastního id, projekty a úkoly podle data->>'clientId'.
-- Šablony a denní plány se nesdílejí (zůstávají s původní policy ze schema.sql).

drop policy if exists "vlastni radky" on public.clients;
create policy "vlastni a sdilene" on public.clients
  for all to authenticated
  using (
    user_id = (select auth.uid())
    or id::text in (select public.shared_client_ids())
  )
  with check (
    user_id = (select auth.uid())
    or id::text in (select public.shared_client_ids())
  );

drop policy if exists "vlastni radky" on public.projects;
drop policy if exists "vlastni a sdilene" on public.projects;
create policy "vlastni a sdilene" on public.projects
  for all to authenticated
  using (
    user_id = (select auth.uid())
    or data->>'clientId' in (select public.shared_client_ids())
  )
  with check (
    user_id = (select auth.uid())
    or data->>'clientId' in (select public.shared_client_ids())
  );

-- Úkoly mají navíc výjimku po jednotlivcích: `data->'hiddenFrom'` je seznam
-- id lidí, kterým se TENHLE úkol neukazuje, i když klienta sdílíme.
-- Sdílený klient je tím dohoda o rozsahu, ne o každém řádku — u klienta
-- se dělá i práce, do které kolegovi nic není.
--
-- Skrytí musí platit na SERVERU, ne až v appce: filtr v UI by data pořád
-- posílal do cizího zařízení a stačilo by se podívat do IndexedDB.
--
-- Vlastní řádek (`user_id = auth.uid()`) je schválně první a bez výjimky —
-- ze svého vlastního úkolu se nikdo nevyřadí ani omylem. A kdo v seznamu
-- je, na řádek nedosáhne vůbec, takže se z něj nemůže sám vyškrtnout.
drop policy if exists "vlastni radky" on public.tasks;
drop policy if exists "vlastni a sdilene" on public.tasks;
create policy "vlastni a sdilene" on public.tasks
  for all to authenticated
  using (
    user_id = (select auth.uid())
    or (
      data->>'clientId' in (select public.shared_client_ids())
      and not (coalesce(data->'hiddenFrom', '[]'::jsonb) ? ((select auth.uid())::text))
    )
  )
  with check (
    user_id = (select auth.uid())
    or (
      data->>'clientId' in (select public.shared_client_ids())
      and not (coalesce(data->'hiddenFrom', '[]'::jsonb) ? ((select auth.uid())::text))
    )
  );

-- ---------------------------------------------------------------------------
-- Správa sdílení (volá appka)
-- ---------------------------------------------------------------------------

-- Sdílet klienta s někým dalším podle e-mailu.
-- Vrací: 'ok' | 'not_found' (účet s tím e-mailem neexistuje) | 'self' | 'not_owner'.
create or replace function public.share_client(p_client_id uuid, p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  -- Sdílet smí jen majitel klienta.
  if not exists (
    select 1 from public.clients c
    where c.id = p_client_id and c.user_id = (select auth.uid())
  ) then
    return 'not_owner';
  end if;

  select u.id into target
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  limit 1;

  if target is null then return 'not_found'; end if;
  if target = (select auth.uid()) then return 'self'; end if;

  insert into public.shares (client_id, owner_id, member_id)
  values (p_client_id, (select auth.uid()), target)
  on conflict (client_id, member_id) do nothing;

  return 'ok';
end;
$$;

revoke all on function public.share_client(uuid, text) from public, anon;
grant execute on function public.share_client(uuid, text) to authenticated;

-- Zrušit sdílení. Smí majitel (odebere kohokoli) i člen sám sebe (odejde).
create or replace function public.unshare_client(p_client_id uuid, p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  select u.id into target
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  limit 1;

  if target is null then return 'not_found'; end if;

  delete from public.shares s
  where s.client_id = p_client_id
    and s.member_id = target
    and (s.owner_id = (select auth.uid()) or s.member_id = (select auth.uid()));

  return 'ok';
end;
$$;

revoke all on function public.unshare_client(uuid, text) from public, anon;
grant execute on function public.unshare_client(uuid, text) to authenticated;

-- S kým je klient sdílený — pro výpis v appce. Vidí jen účastník sdílení.
-- is_owner rozliší majitele od členů (appka podle toho nabídne „odebrat"
-- versus „odejít ze sdílení").
-- Vrací i user_id: podle něj se u jednotlivého úkolu zapisuje, komu se
-- nemá ukazovat (`hiddenFrom`). E-mail by se do sdílených dat psát nesměl —
-- četl by ho každý, kdo na řádek dosáhne.
--
-- Návratový typ se změnil, proto drop: `create or replace` typ nepřepíše.
drop function if exists public.list_client_shares(uuid);
create or replace function public.list_client_shares(p_client_id uuid)
returns table (email text, is_owner boolean, user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct u.email::text as email, (u.id = s.owner_id) as is_owner, u.id as user_id
  from public.shares s
  join auth.users u on u.id in (s.owner_id, s.member_id)
  where s.client_id = p_client_id
    and (s.owner_id = (select auth.uid()) or s.member_id = (select auth.uid()))
  order by is_owner desc, email
$$;

revoke all on function public.list_client_shares(uuid) from public, anon;
grant execute on function public.list_client_shares(uuid) to authenticated;

-- Všechna moje sdílení naráz — appka si tím hlídá, že se rozsah viditelných
-- dat změnil (pak musí stáhnout znovu úplně všechno, protože nově zpřístupněné
-- řádky mají staré updated_at a běžný kurzorový pull by je přeskočil).
create or replace function public.my_shares()
returns table (client_id uuid, is_owner boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.client_id, (s.owner_id = (select auth.uid())) as is_owner
  from public.shares s
  where s.owner_id = (select auth.uid()) or s.member_id = (select auth.uid())
  order by s.client_id
$$;

revoke all on function public.my_shares() from public, anon;
grant execute on function public.my_shares() to authenticated;

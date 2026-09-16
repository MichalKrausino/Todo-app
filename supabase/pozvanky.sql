-- Pozvánky ke sdílení + živá data.
-- Spusť jednou v Supabase → SQL Editor (navazuje na shares.sql).
--
-- PROBLÉM SLEPICE A VEJCE
--
-- `share_client` odmítal e-mail, pod kterým ještě nikdo účet nemá:
-- „S tímhle e-mailem tu zatím nikdo účet nemá. Ať se nejdřív zaregistruje."
-- Jenže kamarád se má zaregistrovat do appky, kde do té doby neuvidí nic —
-- a ten, kdo zve, si musí pamatovat, že se má po jeho registraci vrátit
-- a sdílení dokončit. Sdílení tím nešlo ZAČÍT, jen dokončit.
--
-- Řešení: pozvánka se uloží k e-mailu a při prvním přihlášení se sama
-- promění ve sdílení. Zvoucí udělá jeden krok a je hotovo; pozvaný se
-- přihlásí a klienta prostě má.

create table if not exists public.invites (
  client_id uuid not null references public.clients (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- E-mail v malých písmenech, aby „Jana@X.cz" a „jana@x.cz" byl týž člověk.
  email text not null,
  created_at timestamptz not null default now(),
  primary key (client_id, email)
);

create index if not exists invites_email_idx on public.invites (email);

-- RLS zapnuté BEZ policies = klient na tabulku přímo nedosáhne.
-- Všechno jde přes security definer funkce níž. Je to důležitější, než
-- se zdá: jinak by šlo z appky vyčíst, koho kdo zve.
alter table public.invites enable row level security;

-- ---------------------------------------------------------------------------
-- Sdílení, které umí pozvat i toho, kdo tu ještě není
-- ---------------------------------------------------------------------------

-- Vrací: 'ok' (rovnou sdíleno) | 'invited' (pozvánka čeká na registraci)
--      | 'self' | 'not_owner'.
create or replace function public.share_client(p_client_id uuid, p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
  mail text := lower(trim(p_email));
begin
  if not exists (
    select 1 from public.clients c
    where c.id = p_client_id and c.user_id = (select auth.uid())
  ) then
    return 'not_owner';
  end if;

  select u.id into target from auth.users u where lower(u.email) = mail limit 1;

  if target = (select auth.uid()) then return 'self'; end if;

  if target is null then
    insert into public.invites (client_id, owner_id, email)
    values (p_client_id, (select auth.uid()), mail)
    on conflict (client_id, email) do nothing;
    return 'invited';
  end if;

  insert into public.shares (client_id, owner_id, member_id)
  values (p_client_id, (select auth.uid()), target)
  on conflict (client_id, member_id) do nothing;

  return 'ok';
end;
$$;

revoke all on function public.share_client(uuid, text) from public, anon;
grant execute on function public.share_client(uuid, text) to authenticated;

-- Zrušit sdílení NEBO nevyzvednutou pozvánku. Odvolat pozvánku musí jít
-- stejně snadno jako ji poslat — jinak by překlep v e-mailu zůstal viset
-- napořád a při registraci toho člověka by se probudil.
create or replace function public.unshare_client(p_client_id uuid, p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
  mail text := lower(trim(p_email));
begin
  delete from public.invites i
  where i.client_id = p_client_id
    and i.email = mail
    and i.owner_id = (select auth.uid());

  select u.id into target from auth.users u where lower(u.email) = mail limit 1;
  if target is null then return 'ok'; end if;

  delete from public.shares s
  where s.client_id = p_client_id
    and s.member_id = target
    and (s.owner_id = (select auth.uid()) or s.member_id = (select auth.uid()));

  return 'ok';
end;
$$;

revoke all on function public.unshare_client(uuid, text) from public, anon;
grant execute on function public.unshare_client(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Vyzvednutí pozvánek při přihlášení
-- ---------------------------------------------------------------------------

-- Vrací počet pozvánek, které se právě proměnily ve sdílení. Appka podle
-- toho pozná, že se jí rozšířil rozsah dat, a stáhne znovu všechno —
-- nově zpřístupněné řádky mají staré `updated_at` a kurzorový pull by je
-- jinak přeskočil (viz ensureShareScope v src/sync/engine.ts).
--
-- Bere se e-mail z auth.users, ne z parametru: kdyby si ho volající směl
-- zvolit, vyzvedl by si cizí pozvánky.
create or replace function public.claim_invites()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  mail text;
  pocet integer;
begin
  select lower(u.email) into mail from auth.users u where u.id = (select auth.uid());
  if mail is null then return 0; end if;

  with vzate as (
    delete from public.invites i where i.email = mail returning i.client_id, i.owner_id
  ), vlozene as (
    insert into public.shares (client_id, owner_id, member_id)
    select v.client_id, v.owner_id, (select auth.uid()) from vzate v
    on conflict (client_id, member_id) do nothing
    returning 1
  )
  select count(*) into pocet from vlozene;

  return coalesce(pocet, 0);
end;
$$;

revoke all on function public.claim_invites() from public, anon;
grant execute on function public.claim_invites() to authenticated;

-- Výpis včetně nevyzvednutých pozvánek, ať zvoucí vidí, na koho se čeká.
-- `pending` odlišuje „už je uvnitř" od „pozvánka leží v e-mailu".
drop function if exists public.list_client_shares(uuid);
create or replace function public.list_client_shares(p_client_id uuid)
returns table (email text, is_owner boolean, user_id uuid, pending boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct u.email::text as email, (u.id = s.owner_id) as is_owner, u.id as user_id, false as pending
  from public.shares s
  join auth.users u on u.id in (s.owner_id, s.member_id)
  where s.client_id = p_client_id
    and (s.owner_id = (select auth.uid()) or s.member_id = (select auth.uid()))
  union all
  select i.email, false, null::uuid, true
  from public.invites i
  where i.client_id = p_client_id and i.owner_id = (select auth.uid())
  order by is_owner desc, pending, email
$$;

revoke all on function public.list_client_shares(uuid) from public, anon;
grant execute on function public.list_client_shares(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Živá data
-- ---------------------------------------------------------------------------

-- Dosud: kdo odškrtl úkol, poslal ho na server po 2,5 s — a druhé zařízení
-- se na změny ptalo jednou za minutu. Odškrtnutí u kolegy tak mohlo být
-- vidět až za minutu, což u společné práce vypadá jako rozbitá appka.
--
-- Realtime se tu NEPOUŽÍVÁ jako druhý zdroj dat. Událost je jen ŤUKNUTÍ
-- („na serveru se něco změnilo") a appka na ni odpoví stávajícím pullem.
-- Má to dvě výhody, kvůli kterým to tak je: (1) nevzniká druhá cesta, na
-- které by se dalo rozejít s LWW a tombstony, a (2) na obsahu události
-- nezáleží, takže z ní nemůže nic uniknout, ani kdyby přišla událost
-- o cizím řádku.
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.projects;
alter publication supabase_realtime add table public.clients;

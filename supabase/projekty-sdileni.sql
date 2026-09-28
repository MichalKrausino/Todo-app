-- ---------------------------------------------------------------------------
-- Sdílení po projektech (nadstavba nad supabase/shares.sql)
--
-- Jednotkou sdílení byl KLIENT: co pod ním visí, šlo s ním. Jenže u jednoho
-- klienta se dělá i práce, do které kolegovi nic není, a vyjmout ji šlo
-- dosud jen po jednotlivých úkolech (`hiddenFrom`). U celého projektu to
-- znamená odškrtat ho úkol po úkolu a na každý další nový nezapomenout —
-- tedy práce navíc, která se jednou zapomene a tím přestane platit.
--
-- Nově se u každého sdílení vede SEZNAM ZAŠKRTNUTÝCH PROJEKTŮ.
--
-- VÝCHOZÍ STAV JE „NESDÍLENO", NE „SDÍLENO".
-- Nově založený projekt u sdíleného klienta kolega nevidí, dokud ho
-- majitel nezaškrtne. Je to vědomá volba: přísnější a tišší varianta.
-- Tichost se musí dohnat v appce — práce přiřazená kolegovi v nesdíleném
-- projektu by se k němu nedostala a nikde by to nebylo vidět, takže to
-- appka říká nahlas a nabídne projekt nasdílet (nikdy to neudělá sama,
-- to by tenhle výchozí stav obešlo).
--
-- FILTR PLATÍ JEN NA ČLENSKÉ STRANĚ. `shared_client_ids()` vrací klienty,
-- kde jsem člen NEBO majitel. Kdyby na téhle jedné funkci visel i filtr
-- projektů, přestal by majitel vidět úkoly, které kolega založil
-- v projektu, jenž se později odškrtl — tedy VLASTNÍ data. Proto jsou
-- členská a majitelská strana rozdělené na dvě funkce.
--
-- Spouští se v SQL editoru, celé najednou, a je to idempotentní.
-- ---------------------------------------------------------------------------

-- Seznam zaškrtnutých projektů u jednoho sdílení. Prázdné pole = kolega
-- vidí z klienta jen to, co nepatří pod žádný projekt.
alter table public.shares
  add column if not exists project_ids uuid[] not null default '{}';

comment on column public.shares.project_ids is
  'Projekty klienta, které tenhle člen vidí. Výchozí prázdno = žádný.';

-- ---------------------------------------------------------------------------
-- Rozsah po stranách
-- ---------------------------------------------------------------------------

-- Klienti, u kterých jsem MAJITEL sdílení: vidím v nich úplně všechno,
-- včetně toho, co tam založil kolega. Odškrtnutí projektu je omezení pro
-- NĚJ, ne ztráta dat pro mě.
create or replace function public.vlastnicke_klient_ids()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select s.client_id::text
  from public.shares s
  where s.owner_id = (select auth.uid())
$$;

-- Klienti, u kterých jsem ČLEN: tam se rozsah řídí zaškrtnutými projekty.
create or replace function public.clenske_klient_ids()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select s.client_id::text
  from public.shares s
  where s.member_id = (select auth.uid())
$$;

-- Projekty, které mi jako členovi někdo zaškrtl.
create or replace function public.clenske_projekt_ids()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select p::text
  from public.shares s, unnest(s.project_ids) as p
  where s.member_id = (select auth.uid())
$$;

revoke all on function public.vlastnicke_klient_ids() from public, anon;
revoke all on function public.clenske_klient_ids() from public, anon;
revoke all on function public.clenske_projekt_ids() from public, anon;
grant execute on function public.vlastnicke_klient_ids() to authenticated;
grant execute on function public.clenske_klient_ids() to authenticated;
grant execute on function public.clenske_projekt_ids() to authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
-- Klienti se NEMĚNÍ: sdílený klient je pořád sdílený celý, jen se v něm
-- kolegovi ukáže méně. Kdyby zmizel i klient, neměl by ten zbytek kam patřit.

-- Projekt vidí: jeho autor, majitel sdílení, a člen, kterému je zaškrtnutý.
-- Vlastní řádek zůstává první a bez výjimky, takže projekt, který si kolega
-- u sdíleného klienta založí sám, mu nezmizí pod rukama.
drop policy if exists "vlastni a sdilene" on public.projects;
create policy "vlastni a sdilene" on public.projects
  for all to authenticated
  using (
    user_id = (select auth.uid())
    or data->>'clientId' in (select public.vlastnicke_klient_ids())
    or id::text in (select public.clenske_projekt_ids())
  )
  with check (
    user_id = (select auth.uid())
    or data->>'clientId' in (select public.vlastnicke_klient_ids())
    or id::text in (select public.clenske_projekt_ids())
  );

-- Úkol vidí: jeho autor, majitel sdílení, a člen — ten ale jen když úkol
-- buď nepatří pod žádný projekt (to je práce u klienta samotného), nebo
-- patří pod projekt, který má zaškrtnutý. `hiddenFrom` platí dál a je
-- nad tím: vyjmutý člověk nedosáhne na řádek, i kdyby projekt sdílený byl.
drop policy if exists "vlastni a sdilene" on public.tasks;
create policy "vlastni a sdilene" on public.tasks
  for all to authenticated
  using (
    user_id = (select auth.uid())
    or (
      not (coalesce(data->'hiddenFrom', '[]'::jsonb) ? ((select auth.uid())::text))
      and (
        data->>'clientId' in (select public.vlastnicke_klient_ids())
        or (
          data->>'clientId' in (select public.clenske_klient_ids())
          and (
            coalesce(data->>'projectId', '') = ''
            or data->>'projectId' in (select public.clenske_projekt_ids())
          )
        )
      )
    )
  )
  with check (
    user_id = (select auth.uid())
    or (
      not (coalesce(data->'hiddenFrom', '[]'::jsonb) ? ((select auth.uid())::text))
      and (
        data->>'clientId' in (select public.vlastnicke_klient_ids())
        or (
          data->>'clientId' in (select public.clenske_klient_ids())
          and (
            coalesce(data->>'projectId', '') = ''
            or data->>'projectId' in (select public.clenske_projekt_ids())
          )
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Správa výběru (volá appka)
-- ---------------------------------------------------------------------------

-- Nastavit, které projekty tenhle člen u klienta vidí. Smí jen majitel:
-- kdyby si rozsah směl měnit člen, nebylo by to sdílení, ale samoobsluha.
-- Vrací: 'ok' | 'not_found' (ten e-mail nemá účet) | 'not_owner'.
create or replace function public.set_shared_projects(
  p_client_id uuid,
  p_email text,
  p_project_ids uuid[]
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
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

  update public.shares s
     set project_ids = coalesce(p_project_ids, '{}')
   where s.client_id = p_client_id
     and s.member_id = target
     and s.owner_id = (select auth.uid());

  if not found then return 'not_found'; end if;
  return 'ok';
end;
$$;

revoke all on function public.set_shared_projects(uuid, text, uuid[]) from public, anon;
grant execute on function public.set_shared_projects(uuid, text, uuid[]) to authenticated;

-- Výpis sdílení teď nese i zaškrtnuté projekty, aby je appka mohla ukázat
-- jako přepínače. Návratový typ se mění, proto drop — `create or replace`
-- typ nepřepíše.
--
-- POZOR: tahle funkce je od `pozvanky.sql` SLOŽENÁ ZE DVOU ČÁSTÍ — ke sdílením
-- se přidávají nevyzvednuté pozvánky s `pending = true`. Kdyby se tady
-- přegenerovala podle původní verze ze `shares.sql`, zmizely by pozvánky
-- z výpisu a zvoucí by nepoznal „už je uvnitř" od „ještě se nepřihlásil".
-- U pozvánky žádné projekty zaškrtnuté nejsou: ten člověk ještě nemá účet,
-- takže ani řádek ve `shares` — vybrat se dají, až sdílení vznikne.
drop function if exists public.list_client_shares(uuid);
create or replace function public.list_client_shares(p_client_id uuid)
returns table (email text, is_owner boolean, user_id uuid, pending boolean, project_ids uuid[])
language sql
stable
security definer
set search_path = ''
as $$
  select distinct
         u.email::text as email,
         (u.id = s.owner_id) as is_owner,
         u.id as user_id,
         false as pending,
         s.project_ids
  from public.shares s
  join auth.users u on u.id in (s.owner_id, s.member_id)
  where s.client_id = p_client_id
    and (s.owner_id = (select auth.uid()) or s.member_id = (select auth.uid()))
  union all
  select i.email, false, null::uuid, true, '{}'::uuid[]
  from public.invites i
  where i.client_id = p_client_id and i.owner_id = (select auth.uid())
  order by is_owner desc, pending, email
$$;

revoke all on function public.list_client_shares(uuid) from public, anon;
grant execute on function public.list_client_shares(uuid) to authenticated;

-- Otisk rozsahu musí nést i výběr projektů: když majitel projekt odškrtne,
-- rozsah viditelných dat se změnil, ale řádkům se `updated_at` nehnulo —
-- kurzorový pull by se o tom nedozvěděl. Appka na změnu otisku nuluje
-- kurzory a stahuje znovu (`ensureShareScope`).
drop function if exists public.my_shares();
create or replace function public.my_shares()
returns table (client_id uuid, is_owner boolean, project_ids uuid[])
language sql
stable
security definer
set search_path = ''
as $$
  select s.client_id,
         (s.owner_id = (select auth.uid())) as is_owner,
         s.project_ids
  from public.shares s
  where s.owner_id = (select auth.uid()) or s.member_id = (select auth.uid())
  order by s.client_id
$$;

revoke all on function public.my_shares() from public, anon;
grant execute on function public.my_shares() to authenticated;

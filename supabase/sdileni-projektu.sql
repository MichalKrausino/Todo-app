-- ---------------------------------------------------------------------------
-- Sdílí se PROJEKT po jednom, ne všechny projekty klienta
-- (nadstavba nad supabase/shares.sql a supabase/sdileni-ukolu.sql)
--
-- Dosud: sdílený klient = kolega viděl VŠECHNY jeho projekty, i ty, ve
-- kterých pro něj nic nebylo — tedy jejich názvy a cíle. U klienta se ale
-- dělá i práce, do které kolegovi nic není, a už jméno projektu o ní
-- něco říká.
--
-- Nově je projekt soukromý svému autorovi stejně jako úkol a sdílí se po
-- jednom, konkrétním lidem (`data->'sharedWith'`). Oběma směry: kolega
-- může založit projekt u mého klienta a ukázat mi ho.
--
-- Projekt a úkol se sdílejí NEZÁVISLE: nasdílený projekt ukáže jen sebe,
-- úkoly v něm se dál vybírají po jednom (sdileni-ukolu.sql se nemění).
-- A nasdílený úkol z projektu, který kolega nevidí, uvidí bez projektu —
-- jméno nesdíleného projektu se k němu nedostane.
--
-- DVĚ PODMÍNKY, OBĚ NUTNÉ (stejně jako u úkolů): projekt mi musí být
-- nasdílený, A jeho klient musí být pořád ve živém sdílení se mnou — bez
-- té druhé by zrušené sdílení klienta nezrušilo nic.
--
-- Spouští se v SQL editoru, celé najednou, a je idempotentní.
-- ---------------------------------------------------------------------------

drop policy if exists "vlastni a sdilene" on public.projects;
create policy "vlastni a sdilene" on public.projects
  for all to authenticated
  using (
    user_id = (select auth.uid())
    or (
      coalesce(data->'sharedWith', '[]'::jsonb) ? ((select auth.uid())::text)
      and data->>'clientId' in (select public.shared_client_ids())
    )
  )
  with check (
    user_id = (select auth.uid())
    or (
      coalesce(data->'sharedWith', '[]'::jsonb) ? ((select auth.uid())::text)
      and data->>'clientId' in (select public.shared_client_ids())
    )
  );

-- Pozn. k `with check`: kolega smí nasdílený projekt upravit (přejmenovat,
-- uzavřít), ale ne se z něj vyškrtnout — o sdílení rozhoduje autor.
-- `user_id` při úpravě cizího řádku drží `lww_guard`.

-- ---------------------------------------------------------------------------
-- Sonda: umí tenhle server sdílení po projektech?
-- ---------------------------------------------------------------------------
-- Appka a SQL se nasazují zvlášť. Mezi tím by server ukazoval kolegovi
-- všechny projekty, zatímco appka by u projektu tvrdila „jen tvůj" —
-- appka se proto napřed zeptá a chybějící funkce = řekne to nahlas.
create or replace function public.sdileni_po_projektech()
returns boolean
language sql
stable
as $$ select true $$;

revoke all on function public.sdileni_po_projektech() from public, anon;
grant execute on function public.sdileni_po_projektech() to authenticated;

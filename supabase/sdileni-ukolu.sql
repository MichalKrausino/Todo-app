-- ---------------------------------------------------------------------------
-- Sdílí se ÚKOL, ne klient (nadstavba nad supabase/shares.sql)
--
-- Dosud: sdílený klient = kolega viděl všechno, co pod ním visí, a vyjmout
-- šlo jen po jednotlivých úkolech (`hiddenFrom`). U jednoho klienta se ale
-- dělá i práce, do které kolegovi nic není, a „všechno, kromě toho, na co
-- nezapomenu" je slib, který se jednou poruší — a pak už nejde vzít zpátky,
-- protože kolega to viděl.
--
-- Nově je to obráceně: ÚKOL JE SOUKROMÝ SVÉMU AUTOROVI a sdílí se po
-- jednom, konkrétním lidem (`data->'sharedWith'`, seznam id). Platí to
-- OBĚMA SMĚRY: majitel klienta sdílí kolegovi a kolega majiteli stejným
-- způsobem. Majitel klienta tedy AUTOMATICKY NEVIDÍ úkoly, které si kolega
-- u jeho klienta založil — vidí jen ty, které mu kolega nasdílí nebo
-- přidělí. To je ta symetrie, o kterou jde.
--
-- Klient a jeho projekty se sdílejí dál celé (policies ze shares.sql se
-- nemění): kolega vidí strukturu, do které může sám zakládat, ale obsah
-- mu přichází jen ten, který mu někdo dá.
--
-- DVĚ PODMÍNKY, OBĚ NUTNÉ: úkol mi musí být nasdílený, A jeho klient musí
-- být pořád ve živém sdílení se mnou. Bez té druhé by zrušené sdílení
-- klienta nic nezrušilo — `sharedWith` v úkolech by zůstal a kolega by na
-- ně dál dosáhl. `shared_client_ids()` vrací klienty, kde jsem člen NEBO
-- majitel, takže podmínka platí stejně v obou směrech.
--
-- Úkol bez klienta se nesdílí nikdy: bez klienta není žádné sdílení, ve
-- kterém by mohl žít.
--
-- Spouští se v SQL editoru, celé najednou, a je idempotentní.
-- ---------------------------------------------------------------------------

drop policy if exists "vlastni a sdilene" on public.tasks;
create policy "vlastni a sdilene" on public.tasks
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

-- Pozn. k `with check`: kolega smí nasdílený úkol upravovat (odškrtnout,
-- přepsat termín) — nový řádek ho v `sharedWith` pořád má, takže projde.
-- Vyškrtnout se ze sdílení cizího úkolu ale nemůže: nový řádek by ho už
-- neobsahoval a kontrola by ho odmítla. O sdílení rozhoduje autor úkolu.
-- `user_id` při úpravě cizího řádku drží `lww_guard`, takže se z úkolu
-- nikdy nestane kolegův jen tím, že na něj sáhne.

-- ---------------------------------------------------------------------------
-- Sonda: umí tenhle server sdílení po úkolech?
-- ---------------------------------------------------------------------------
-- Appka a SQL se nasazují zvlášť: appka jde po mergi sama, SQL se spouští
-- ručně. Mezi tím by server dál sdílel CELÉHO klienta, zatímco appka by
-- u úkolu ukazovala „Jen já" — tichá lež o tom, kdo co vidí, a zrovna
-- o datech, která kolega dostane do svého zařízení. Appka se proto napřed
-- zeptá; chybějící funkce = starý server a appka to řekne nahlas.
create or replace function public.sdileni_po_ukolech()
returns boolean
language sql
stable
as $$ select true $$;

revoke all on function public.sdileni_po_ukolech() from public, anon;
grant execute on function public.sdileni_po_ukolech() to authenticated;

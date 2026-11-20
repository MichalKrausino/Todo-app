-- Smazat (nebo vrátit ze smazání) sdíleného klienta a jeho projekty smí
-- jen MAJITEL.
--
-- Policy na `clients` a `projects` dává členovi sdílení `for all` — i úpravu,
-- a tombstone je úprava (`deleted_at`). Člen, který v appce ťukl „Smazat
-- klienta" s představou „ať mi zmizí ze seznamu", tak klienta smazal i
-- majiteli: novější razítko vyhrálo podle last-write-wins a kaskáda v appce
-- (`removeClient`) tombstonovala i majitelovy úkoly a projekty, na které
-- člen dosáhl. „Vrátit" přitom viděl jen ten, kdo mazal.
--
-- Trigger změnu `deleted_at` od kohokoli jiného než majitele tiše zahodí
-- (stejně jako lww_guard zahazuje starší zápis — upsert projde bez chyby
-- a zbytek dávky se neodmítne). Appka členovi mazání ani archivaci cizího
-- klienta nenabízí (KlientSheet); tohle je pojistka pro starší verze appky
-- a pro cokoli mimo ni.
--
-- Service role (edge funkce, cron) má `auth.uid()` prázdné a projde.
-- Trigger běží po `<tabulka>_lww` a před `<tabulka>_zz_synced`, takže
-- zahozený zápis nedostane ani serverové razítko.

create or replace function public.mazani_jen_majitel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and auth.uid() <> old.user_id
     and new.deleted_at is distinct from old.deleted_at then
    return null;
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['clients', 'projects'] loop
    if not exists (
      select 1 from pg_trigger
      where tgname = t || '_mazani' and tgrelid = format('public.%I', t)::regclass
    ) then
      execute format(
        'create trigger %I before update on public.%I for each row execute function public.mazani_jen_majitel()',
        t || '_mazani', t
      );
    end if;
  end loop;
end;
$$;

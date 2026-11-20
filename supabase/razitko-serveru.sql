-- Serverové razítko pro stahování (pull).
--
-- Stahování se ptalo „co je novější než můj kurzor" podle `updated_at` —
-- a to razítko píše ZAŘÍZENÍ svými hodinami, ne server. Kurzor proto po
-- každém průchodu stál na posledním vlastním zápisu a cokoli, co na server
-- dorazilo POZDĚJI se starším razítkem, už se nestáhlo nikdy:
--
--   telefon offline v metru odškrtne úkol v 8:10, Mac v 8:20 něco upraví
--   (jeho kurzor je 8:20), telefon se v 8:30 připojí a pošle odškrtnutí
--   s razítkem 8:10 → Mac se ptá na „> 8:20" a úkol má otevřený navždy.
--   Kdyby ho pak na Macu upravil, novější razítko by vyhrálo a odškrtnutí
--   by zmizelo i ze serveru.
--
-- Totéž udělá pár vteřin rozjetých hodin nebo zpoždění odeslání mezi dvěma
-- kolegy. U odesílání se tahle past řešila dávno (evidence odeslaných
-- verzí, src/sync/outbox.ts); stahování na ní stálo dál.
--
-- `synced_at` razítkuje server (`clock_timestamp()`) při každém zápisu,
-- který opravdu projde — zápis, který `lww_guard` zahodí, řádek nemění,
-- takže razítko nedostane. Stahuje se podle dvojice (synced_at, id), takže
-- ani řádky se stejným razítkem na hraně stránky nevypadnou.
--
-- `updated_at` zůstává, čím byl: pravdou pro last-write-wins. Starší verze
-- appky (v mezipaměti telefonu) dál stahují podle něj a fungují jako dřív.
--
-- Trigger se jmenuje `<tabulka>_zz_synced`, aby běžel až po `<tabulka>_lww`
-- (BEFORE triggery jdou podle abecedy): když lww_guard zápis zahodí, na
-- razítko se vůbec nedojde.
--
-- Nic se tu nemaže (databázový nástroj v sezení s Claude čeká u `drop` na
-- potvrzení člověka) — trigger se zakládá, jen když ještě není.

create or replace function public.razitko_serveru()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.synced_at := clock_timestamp();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['clients', 'projects', 'tasks', 'templates', 'day_plans'] loop
    execute format(
      'alter table public.%I add column if not exists synced_at timestamptz not null default clock_timestamp()',
      t
    );
    execute format('create index if not exists %I on public.%I (synced_at, id)', t || '_synced_idx', t);
    if not exists (
      select 1 from pg_trigger
      where tgname = t || '_zz_synced' and tgrelid = format('public.%I', t)::regclass
    ) then
      execute format(
        'create trigger %I before insert or update on public.%I for each row execute function public.razitko_serveru()',
        t || '_zz_synced', t
      );
    end if;
  end loop;
end;
$$;

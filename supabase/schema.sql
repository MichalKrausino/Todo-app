-- Schéma synchronizace (Fáze 2). Spusť jednou v Supabase → SQL Editor.
--
-- Každá entita má vlastní tabulku se stejným tvarem: plný záznam žije v jsonb
-- sloupci `data` (přesně jak ho zná appka), `updated_at`/`deleted_at` jsou
-- vytažené kvůli dotazům a indexům. Server je záloha a zdroj pro pozdější
-- fáze (ranní návrh dne čte úkoly přes data->>'...').
--
-- Konflikty řeší last-write-wins podle updated_at: trigger lww_guard tiše
-- zahodí update se starším časem, takže klient může bezpečně upsertovat.

create or replace function public.lww_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.updated_at <= old.updated_at then
    return null; -- starší zápis prohrává, upsert projde bez chyby
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['clients', 'projects', 'tasks', 'templates', 'day_plans'] loop
    execute format($f$
      create table if not exists public.%I (
        id uuid primary key,
        user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
        data jsonb not null,
        updated_at timestamptz not null,
        deleted_at timestamptz
      )
    $f$, t);

    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "vlastni radky" on public.%I', t);
    execute format($f$
      create policy "vlastni radky" on public.%I
        for all to authenticated
        using (user_id = (select auth.uid()))
        with check (user_id = (select auth.uid()))
    $f$, t);

    execute format(
      'create index if not exists %I on public.%I (user_id, updated_at)',
      t || '_user_updated_idx', t
    );

    execute format('drop trigger if exists %I on public.%I', t || '_lww', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.lww_guard()',
      t || '_lww', t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fáze 6: push notifikace + ranní návrh dne
-- (Na projektu už aplikováno migracemi; tady jako dokumentace stavu.)
-- ---------------------------------------------------------------------------

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
-- policy „vlastni radky" stejně jako u ostatních tabulek

-- VAPID klíče v schématu private (čte je jen service role přes RPC
-- public.get_vapid_keys, execute má pouze service_role).

-- Plánovač: pg_cron + pg_net; job „morning-plan" volá edge funkci
-- /functions/v1/morning-plan denně v 5:00 UTC (7:00 léto / 6:00 zima).
-- Funkce skóruje kandidáty (termíny, priority, odklady, zanedbaní klienti),
-- uloží DayPlan do day_plans (sync ho stáhne do appky) a pošle push.

-- ---------------------------------------------------------------------------
-- Fáze 3 (příprava): Google refresh tokeny pro přístup ke kalendáři
-- ---------------------------------------------------------------------------

-- Tokeny žijí v private schématu — klient je smí jen ZAPSAT přes RPC
-- (write-only), číst je bude výhradně service role (server, Fáze 3).
create table if not exists private.google_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);

create or replace function public.store_google_token(token text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.google_tokens (user_id, refresh_token, updated_at)
  values (auth.uid(), token, now())
  on conflict (user_id) do update
    set refresh_token = excluded.refresh_token, updated_at = now();
$$;

revoke all on function public.store_google_token(text) from public, anon;
grant execute on function public.store_google_token(text) to authenticated;

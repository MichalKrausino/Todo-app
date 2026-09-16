-- Nastavení ranního návrhu dne: v kolik chodí, jestli chodí a kam vede.
-- Spusť jednou v Supabase → SQL Editor (navazuje na schema.sql).
--
-- PROČ TO NEJDE ULOŽIT V APPCE
--
-- Zbytek nastavení appky (vzhled, řazení) je lokální — tohle ne. O tom,
-- jestli a kdy se notifikace pošle, rozhoduje SERVER ve chvíli, kdy je
-- telefon zamčený v kapse. Nastavení proto musí ležet tam, kde ho uvidí
-- edge funkce, ne v localStorage jednoho zařízení. Vedlejší výhoda: platí
-- pro všechna zařízení naráz, protože je to vlastnost člověka, ne mobilu.

create table if not exists public.push_prefs (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  -- Vlastní vypínač ranního návrhu. Odběr push notifikací (tabulka
  -- push_subscriptions) je něco jiného: ten platí pro JEDNO zařízení a
  -- pro VŠECHNY druhy zpráv. Kdo chce připomínky termínů, ale ne ranní
  -- návrh, potřeboval dosud vypnout obojí.
  morning_enabled boolean not null default true,
  -- Místní čas (Europe/Prague) ve tvaru HH:MM. Celá appka počítá dny
  -- v pražském čase (`pragueToday`), takže i tenhle údaj je pražský —
  -- dvě různá pásma v jedné appce jsou dvě různé půlnoci.
  morning_time text not null default '07:00',
  -- 'navrh' = ťuknutí otevře rovnou panel s návrhy, 'dnes' = jen appku.
  morning_target text not null default 'navrh',
  -- Kdy návrh naposledy odešel. Pojistka proti tomu, aby půlhodinový
  -- budíček poslal tutéž zprávu šestkrát — píše ji jen service role.
  last_morning_on date,
  updated_at timestamptz not null default now(),
  constraint push_prefs_time_ck check (morning_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint push_prefs_target_ck check (morning_target in ('navrh', 'dnes'))
);

alter table public.push_prefs enable row level security;

-- Číst smí člověk svoje. Zapisovat NE — od toho je RPC níž.
drop policy if exists "vlastni radky" on public.push_prefs;
create policy "vlastni radky" on public.push_prefs
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Zápis jen přes RPC
-- ---------------------------------------------------------------------------

-- Appka nesmí na `last_morning_on`. Kdyby na něj dosáhla, stačilo by
-- uložit nastavení a razítko „dnes už odešlo" by se ztratilo — návrh by
-- se ten den poslal podruhé. Proto se přes RPC posílají jen tři hodnoty
-- a zbytek řádku zůstává, jak byl.
create or replace function public.set_push_prefs(
  p_enabled boolean,
  p_time text,
  p_target text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.push_prefs (user_id, morning_enabled, morning_time, morning_target, updated_at)
  values ((select auth.uid()), p_enabled, p_time, p_target, now())
  on conflict (user_id) do update
    set morning_enabled = excluded.morning_enabled,
        morning_time = excluded.morning_time,
        morning_target = excluded.morning_target,
        updated_at = now();
end;
$$;

revoke all on function public.set_push_prefs(boolean, text, text) from public, anon;
grant execute on function public.set_push_prefs(boolean, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Plánovač: z jedné pevné hodiny na okno
-- ---------------------------------------------------------------------------

-- Dosud budil cron funkci jednou denně v 5:00 UTC, takže návrh chodil
-- v 7:00 v létě a v 6:00 v zimě — a jinak to ani nešlo, protože cron umí
-- jen UTC. Teď se odpovědnost obrací: cron budí funkci každou půlhodinu
-- v okně a FUNKCE se u každého člověka ptá, jestli už nastal jeho čas
-- (`maPoslat` v kdy.ts, čistá logika s testy).
--
-- Okno 3–11 UTC pokrývá pražských 5–13 v létě a 4–12 v zimě, takže volby
-- 5:00 až 11:00 platí po celý rok včetně obou přechodů na letní čas.
-- Osmnáct probuzení denně; drtivá většina z nich jen přečte nastavení
-- a skončí.
-- Mění se JEN rozvrh. `cron.alter_job` nechá příkaz beze změny, takže se
-- nemusí nikam znovu opisovat klíč z hlavičky — a co se neopisuje, to se
-- nedá přepsat špatně.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'morning-plan'),
  schedule := '*/30 3-11 * * *'
);

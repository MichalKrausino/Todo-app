-- ---------------------------------------------------------------------------
-- Zpřesnění zadání modelem (Fáze 5) — mezipaměť a strop pro edge funkci
-- `zpresni`.
--
-- Každá odpověď modelu se uloží pod otiskem celého vstupu (text, co vytáhl
-- parser, dnešek a seznamy jmen). Druhé zařízení téhož člověka i opakovaný
-- pokus po výpadku sítě dostanou hotovou odpověď a model se neplatí
-- dvakrát. Počet řádků za den je zároveň denní strop na člověka.
--
-- RLS zapnuté BEZ policies: tabulku čte a píše jen edge funkce se service
-- role. Z appky se na ni dosáhnout nedá — jsou v ní texty úkolů.
--
-- Spouští se v SQL editoru, celé najednou, a je idempotentní.
-- ---------------------------------------------------------------------------

create table if not exists public.zpresneni (
  user_id uuid not null references auth.users (id) on delete cascade,
  klic text not null,
  navrh jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, klic)
);

alter table public.zpresneni enable row level security;

create index if not exists zpresneni_den on public.zpresneni (user_id, created_at);

-- Staré odpovědi nemají cenu: klíč obsahuje dnešek, takže po dni se na ně
-- nikdo nezeptá. Úklid jede s ranním cronem, pokud je pg_cron zapnutý.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'zpresneni-uklid';
    perform cron.schedule('zpresneni-uklid', '17 3 * * *',
      $q$delete from public.zpresneni where created_at < now() - interval '7 days'$q$);
  end if;
end $$;

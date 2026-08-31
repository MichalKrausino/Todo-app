-- ---------------------------------------------------------------------------
-- Plánovač upozornění (Fáze 6) — pg_cron + pg_net
-- ---------------------------------------------------------------------------
--
-- Spustit v SQL editoru Supabase. Před spuštěním nahradit <SERVICE-ROLE-KEY>
-- skutečným service role klíčem (Dashboard → Settings → API). Klíč nikdy
-- necommitovat — tenhle soubor zůstává s placeholderem.
--
-- Varianta bez placeholderu (klíč jen ve Vaultu) je dole v části „B".
--
-- Rozvrhy jsou v UTC. V létě (CEST, +2 h) tedy vycházejí na:
--   reminders-due        */10 5-16 * * *   → 7:00–18:50 každých 10 minut
--   reminders-checkpoint 0 9,13 * * 1-5    → 11:00 a 15:00 v pracovní dny
--   reminders-shutdown   30 15 * * 1-5     → 17:30 v pracovní dny
--   reminders-review     0 16 * * 0        → 18:00 v neděli
--   morning-plan         0 5 * * *         → 7:00 (ranní návrh dne, už běží)

-- ===========================================================================
-- A) Rovnou s klíčem v příkazu
-- ===========================================================================

-- Idempotence: staré joby stejného jména nejdřív pryč, ať se nezdvojí.
select cron.unschedule(jobname)
from cron.job
where jobname in (
  'reminders-due',
  'reminders-checkpoint',
  'reminders-shutdown',
  'reminders-review'
);

select cron.schedule('reminders-due', '*/10 5-16 * * *', $job$
  select net.http_post(
    url := 'https://djeadsdsmsurjnneiclx.supabase.co/functions/v1/reminders?kind=due',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <SERVICE-ROLE-KEY>"}'::jsonb,
    body := '{}'::jsonb
  );
$job$);

select cron.schedule('reminders-checkpoint', '0 9,13 * * 1-5', $job$
  select net.http_post(
    url := 'https://djeadsdsmsurjnneiclx.supabase.co/functions/v1/reminders?kind=checkpoint',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <SERVICE-ROLE-KEY>"}'::jsonb,
    body := '{}'::jsonb
  );
$job$);

select cron.schedule('reminders-shutdown', '30 15 * * 1-5', $job$
  select net.http_post(
    url := 'https://djeadsdsmsurjnneiclx.supabase.co/functions/v1/reminders?kind=shutdown',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <SERVICE-ROLE-KEY>"}'::jsonb,
    body := '{}'::jsonb
  );
$job$);

select cron.schedule('reminders-review', '0 16 * * 0', $job$
  select net.http_post(
    url := 'https://djeadsdsmsurjnneiclx.supabase.co/functions/v1/reminders?kind=review',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <SERVICE-ROLE-KEY>"}'::jsonb,
    body := '{}'::jsonb
  );
$job$);

-- Kontrola: mají tu být čtyři joby reminders-* a jeden morning-plan, všechny active.
select jobid, jobname, schedule, active
from cron.job
order by jobname;

-- ===========================================================================
-- B) Varianta s Vaultem — klíč nikde v textu jobu
-- ===========================================================================
--
-- Vault (supabase_vault) je v projektu nainstalovaný. Výhoda: klíč se vkládá
-- jednou, rotace se dělá na jednom místě a příkazy jobů ho neobsahují.
-- Spustit MÍSTO části A, ne k ní.
--
-- 1) Uložit klíč (jednorázově, klíč doplnit místo placeholderu):
--
--    select vault.create_secret('<SERVICE-ROLE-KEY>', 'service_role_key');
--
--    (Při rotaci pak: select vault.update_secret(
--       (select id from vault.secrets where name = 'service_role_key'),
--       '<NOVÝ-KLÍČ>');)
--
-- 2) Pomocná funkce, která upozornění zavolá a klíč si vytáhne až za běhu.
--    security definer + odebrané právo pro anon/authenticated = klíč se
--    přes API nedá přečíst, sáhne na něj jen cron (běží jako postgres).
--
--    create or replace function private.call_reminders(kind text)
--    returns bigint
--    language plpgsql
--    security definer
--    set search_path = ''
--    as $fn$
--    declare
--      key text;
--    begin
--      select decrypted_secret into key
--      from vault.decrypted_secrets
--      where name = 'service_role_key';
--
--      return net.http_post(
--        url := 'https://djeadsdsmsurjnneiclx.supabase.co/functions/v1/reminders?kind='
--               || kind,
--        headers := jsonb_build_object(
--          'Content-Type', 'application/json',
--          'Authorization', 'Bearer ' || key
--        ),
--        body := '{}'::jsonb
--      );
--    end;
--    $fn$;
--
--    revoke all on function private.call_reminders(text) from public, anon, authenticated;
--
-- 3) Joby pak volají jen tu funkci:
--
--    select cron.unschedule(jobname) from cron.job
--    where jobname in ('reminders-due','reminders-checkpoint',
--                      'reminders-shutdown','reminders-review');
--
--    select cron.schedule('reminders-due',        '*/10 5-16 * * *', $$select private.call_reminders('due')$$);
--    select cron.schedule('reminders-checkpoint', '0 9,13 * * 1-5',  $$select private.call_reminders('checkpoint')$$);
--    select cron.schedule('reminders-shutdown',   '30 15 * * 1-5',   $$select private.call_reminders('shutdown')$$);
--    select cron.schedule('reminders-review',     '0 16 * * 0',      $$select private.call_reminders('review')$$);

-- ===========================================================================
-- Jak zjistit, že to běží
-- ===========================================================================
--
-- Posledních 20 spuštění (status 'succeeded' = pg_net požadavek odešel):
--    select jobid, runid, status, return_message, start_time
--    from cron.job_run_details order by start_time desc limit 20;
--
-- Co odpověděla edge funkce:
--    select id, status_code, content, created
--    from net._http_response order by created desc limit 20;

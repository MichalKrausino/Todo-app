-- ---------------------------------------------------------------------------
-- Šabat — od pátečního západu slunce do sobotního se nepípá.
--
-- Michal je věřící a v tu dobu nepracuje. Logika je v edge funkci
-- `reminders` (`supabase/functions/reminders/sabat.ts`, appka dováží týž
-- soubor): během šabatu funkce neposílá nic, žádného druhu. Tady jsou dvě
-- změny rozvrhu, bez kterých by to nestačilo.
--
-- 1) Páteční uzávěrka nesmí přijít až po západu slunce. Běžná úloha
--    `reminders-shutdown` jede v 15:30 UTC a v zimě tou dobou už je
--    šabat (zapadá kolem čtvrté místního) — uzávěrka by tiše propadla.
--    V pátek ji proto posílá vlastní úloha každou čtvrthodinu 14:00–15:45
--    UTC s parametrem `patek=1`; funkce ji pustí jen v té čtvrthodině,
--    kam padne běžný čas, nejpozději ale hodinu před západem
--    (`patecniUzaverka`). Běžná úloha v pátek mlčí, takže uzávěrka přijde
--    právě jednou. Že cíl padne do okna úlohy každý pátek v roce, hlídá
--    test v `src/lib/sabat.test.ts`.
--
-- 2) Ranní návrh se v sobotu nebudí vůbec. Jeho okno (3–11 UTC) v sobotu
--    vždycky padne do šabatu — sobotní západ je nejdřív kolem 15 UTC —,
--    takže stačí rozvrh bez soboty a funkce `morning-plan` se nemusí měnit.
--
-- Příkazy se NEOPISUJÍ: nová úloha si příkaz zkopíruje z běžné uzávěrky
-- (i s klíčem v hlavičce) a ranní návrhu se mění jen rozvrh přes
-- `cron.alter_job`. Klíč tak nikde nestojí v textu a nedá se přepsat
-- špatně. Spouští se v SQL editoru, celé najednou, a je idempotentní.
-- ---------------------------------------------------------------------------

select cron.schedule(
  'reminders-shutdown-patek',
  '*/15 14-15 * * 5',
  (select replace(command, 'kind=shutdown', 'kind=shutdown&patek=1')
     from cron.job where jobname = 'reminders-shutdown')
);

select cron.alter_job(
  (select jobid from cron.job where jobname = 'morning-plan'),
  schedule := '*/30 3-11 * * 0-5'
);

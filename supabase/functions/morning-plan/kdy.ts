// Kdy ranní návrh odejde — čistá logika bez Dena a bez sítě (testuje
// kdy.test.ts). Edge funkce `morning-plan` se jí jen zeptá.
//
// PROČ TO VŮBEC JE
//
// Návrh chodil každý den v 5:00 UTC, tedy v 7:00 v létě a v 6:00 v zimě.
// To nebylo nastavení, ale vedlejší účinek toho, že cron umí jen UTC —
// a hodina, ve kterou člověk začíná den, je jeho věc, ne naše.
//
// Řešení není cron pro každého (tolik úloh se neudrží), ale OBRÁTIT
// ODPOVĚDNOST: cron budí funkci každou půlhodinu v okně a funkce se
// u každého člověka ptá, jestli už nastal jeho čas. Rozhodnutí je proto
// jediná funkce a dá se otestovat bez serveru.

/** Nastavení, jak ho drží tabulka `push_prefs`. */
export interface NastaveniRana {
  morning_enabled?: boolean | null
  /** místní čas (Europe/Prague) ve tvaru HH:MM */
  morning_time?: string | null
  /** kam vede ťuknutí na notifikaci */
  morning_target?: string | null
  /** den, kdy návrh naposledy odešel — pojistka proti druhému poslání */
  last_morning_on?: string | null
}

/** Když si člověk nic nenastavil, platí ta hodina, co platila dosud. */
export const VYCHOZI_CAS = '07:00'
export const VYCHOZI_CIL = 'navrh'

/**
 * Čas na tvar HH:MM. Nesmyslná hodnota se nebere jako „nikdy" — to by
 * notifikace tiše zmizela a nikdo by nevěděl proč; bere se výchozí čas.
 */
export function platnyCas(cas: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec((cas ?? '').trim())
  if (!m) return VYCHOZI_CAS
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return VYCHOZI_CAS
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/**
 * Má návrh právě teď odejít?
 *
 * Pravidlo je „v tuhle hodinu NEBO POZDĚJI, a jen jednou za den". To druhé
 * je pojistka proti tomu, aby půlhodinový budíček poslal návrh šestkrát;
 * to první je pojistka opačná: když funkce ráno vypadne (nasazení, výpadek
 * sítě), pošle se návrh v nejbližším dalším okně místo aby ten den propadl.
 *
 * Chybějící nastavení znamená výchozí stav, ne vypnuto — kdo si nikdy nic
 * nenastavil, má návrh dostávat dál.
 */
export function maPoslat(
  n: NastaveniRana | undefined | null,
  nyni: string,
  dnes: string,
): boolean {
  if (n?.morning_enabled === false) return false
  if ((n?.last_morning_on ?? '').slice(0, 10) === dnes) return false
  return platnyCas(n?.morning_time) <= nyni
}

/**
 * Kam ťuknutí na notifikaci povede. `navrh` otevře rovnou panel s návrhy
 * (o to v té notifikaci jde), `dnes` jen appku.
 *
 * Nedělní odkaz na týdenní ohlédnutí tohle nepřebíjí — to je jiná zpráva
 * a vede jinam ze své podstaty.
 */
export function cilOdkazu(base: string, cil: string | null | undefined): string {
  return (cil ?? VYCHOZI_CIL) === 'dnes' ? base : `${base}#navrh`
}

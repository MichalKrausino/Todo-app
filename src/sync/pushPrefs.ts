// Nastavení ranního návrhu — tenká vrstva nad RPC ze supabase/rano.sql.
//
// Tohle je jedna z mála věcí, které NEJSOU v Dexie, a je to schválně:
// o tom, jestli a kdy notifikace odejde, rozhoduje server ve chvíli, kdy
// je telefon zamčený v kapse. Nastavení proto musí ležet tam, kde ho
// uvidí edge funkce. Vedlejší výhoda: platí pro všechna zařízení naráz,
// protože je to vlastnost člověka, ne mobilu.
//
// Zápis jde přes RPC, ne přes tabulku: `last_morning_on` (razítko „dnes
// už odešlo") patří serveru a appka na něj nesmí. Kdyby na něj dosáhla,
// stačilo by uložit nastavení a návrh by ten den přišel podruhé.

import { getSupabase } from './engine'

export interface NastaveniRana {
  zapnuto: boolean
  cas: string // HH:MM, pražský čas
  cil: 'navrh' | 'dnes'
}

export const VYCHOZI: NastaveniRana = { zapnuto: true, cas: '07:00', cil: 'navrh' }

/**
 * Načte nastavení. `null` znamená „nepodařilo se zeptat" (offline,
 * nepřihlášeno) — a to je něco jiného než „nic nastaveného nemám":
 * rozhraní podle toho pozná, jestli smí ukázat přepínače, nebo má říct,
 * že to chce připojení. Prázdná odpověď naopak znamená výchozí stav,
 * protože řádek vzniká až prvním uložením.
 */
export async function nactiNastaveniRana(): Promise<NastaveniRana | null> {
  const sb = getSupabase()
  if (!sb) return null
  const { data, error } = await sb
    .from('push_prefs')
    .select('morning_enabled, morning_time, morning_target')
    .maybeSingle()
  if (error) return null
  if (!data) return VYCHOZI
  return {
    zapnuto: data.morning_enabled !== false,
    cas: typeof data.morning_time === 'string' ? data.morning_time : VYCHOZI.cas,
    cil: data.morning_target === 'dnes' ? 'dnes' : 'navrh',
  }
}

/** Uloží nastavení. Vrací chybu k zobrazení, nebo `null` při úspěchu. */
export async function ulozNastaveniRana(n: NastaveniRana): Promise<string | null> {
  const sb = getSupabase()
  if (!sb) return 'Nastavení se ukládá na server — chce to připojení.'
  const { error } = await sb.rpc('set_push_prefs', {
    p_enabled: n.zapnuto,
    p_time: n.cas,
    p_target: n.cil,
  })
  return error ? error.message : null
}

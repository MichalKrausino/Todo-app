// Zpřesnění zadání úkolu modelem — čistá logika sdílená serverem a appkou.
//
// Edge funkce `zpresni` z toho staví dotaz na model a čistí jeho odpověď;
// appka (`src/lib/zpresneni.ts`) dováží TENTÝŽ soubor, takže co server
// pustí ven, to appka umí přečíst, a obě strany ověřují stejně. Žádná
// síť ani Deno API tady — testuje to vitest (`navrh.test.ts`).
//
// Model nedostává id z databáze, ale krátké odkazy (k1, p2, l1). Dlouhé
// uuid se špatně opisují a každý přepsaný znak je odkaz, který nikam
// nevede; krátký odkaz se buď trefí do seznamu, nebo se zahodí.

export type Priorita = 'low' | 'normal' | 'high' | 'critical'

export interface Kontext {
  /** Dnešek v Praze, `YYYY-MM-DD` — relativní data („v pátek") se počítají od něj. */
  dnes: string
  klienti: { id: string; jmeno: string }[]
  projekty: { id: string; jmeno: string; klientId: string }[]
  /** Lidé, kterým jde úkol předat (spolupracují se mnou na nějakém klientovi). */
  lide: { id: string; jmeno: string }[]
}

/** Co z textu vytáhl parser v telefonu — model to jen doplňuje. */
export interface Parser {
  nazev: string
  klientId?: string
  projektId?: string
  termin?: string
  cas?: string
  priorita?: Priorita
}

/** Vyčištěný návrh: jen pole, která prošla kontrolou, s id z databáze. */
export interface Navrh {
  nazev?: string
  klientId?: string
  projektId?: string
  termin?: string
  cas?: string
  priorita?: Priorita
  komu?: string
  kroky?: string[]
}

export const LIMITY = {
  zadani: 600,
  klientu: 200,
  projektu: 400,
  lidi: 50,
  jmeno: 80,
  nazev: 200,
  kroku: 8,
  krok: 120,
} as const

const PRIORITY: readonly Priorita[] = ['low', 'normal', 'high', 'critical']

// Výstup modelu. Všechna pole jsou povinná a „nevím" je null — strukturovaný
// výstup pak nemá jak vynechat pole a appka nemusí hádat, jestli chybí,
// protože ho model nenašel, nebo protože ho zapomněl.
const nebo = (t: Record<string, unknown>) => ({ anyOf: [t, { type: 'null' }] })
export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['nazev', 'klient', 'projekt', 'termin', 'cas', 'priorita', 'komu', 'kroky'],
  properties: {
    nazev: nebo({ type: 'string' }),
    klient: nebo({ type: 'string' }),
    projekt: nebo({ type: 'string' }),
    termin: nebo({ type: 'string', format: 'date' }),
    cas: nebo({ type: 'string' }),
    priorita: nebo({ type: 'string', enum: [...PRIORITY] }),
    komu: nebo({ type: 'string' }),
    kroky: { type: 'array', items: { type: 'string' } },
  },
} as const

export const SYSTEM = `Zpřesňuješ zadání úkolu v české todo appce pro marketéra, který pracuje pro více klientů.
Dostaneš původní text, který člověk napsal, a co z něj už vytáhl jednoduchý parser.
Vrať JSON podle schématu. Pravidla:
- nazev: krátký název úkolu v rozkazovacím nebo infinitivním tvaru, bez data, času, klienta, priority a jména člověka, kterému se úkol předává. Velké první písmeno. Pokud parserův název už je dobrý, vrať null.
- klient, projekt, komu: JEN odkaz ze seznamu (např. "k2", "p1", "l1"), nebo null. Nikdy si odkaz nevymýšlej. Projekt musí patřit vybranému klientovi.
- komu: vyplň jen když text výslovně říká, že úkol má udělat ten člověk (např. "ať Ben…", "pro Bena", "předat Benovi"). "Poslat Benovi" je krok, ne předání.
- termin: YYYY-MM-DD, jen když ho text uvádí. Relativní výrazy počítej od data "dnes". Týden začíná pondělím.
- cas: HH:MM ve 24h formátu, jen když ho text uvádí.
- priorita: jen když text výslovně mluví o naléhavosti.
- kroky: dílčí kroky jen tehdy, když text sám vyjmenovává víc věcí, které je potřeba udělat. Nevymýšlej obecné kroky. Jinak prázdné pole.
- Když si něčím nejsi jistý, vrať null. Prázdný návrh je lepší než špatný.`

/** Krátké odkazy pro model a cesta zpátky na id. */
export function odkazy(k: Kontext) {
  const klienti = k.klienti.slice(0, LIMITY.klientu).map((c, i) => ({ ref: `k${i + 1}`, ...c }))
  const projekty = k.projekty.slice(0, LIMITY.projektu).map((p, i) => ({ ref: `p${i + 1}`, ...p }))
  const lide = k.lide.slice(0, LIMITY.lidi).map((l, i) => ({ ref: `l${i + 1}`, ...l }))
  return { klienti, projekty, lide }
}

const DNY = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota']

export function zprava(zadani: string, parser: Parser, k: Kontext): string {
  const o = odkazy(k)
  const refKlienta = (id?: string) => o.klienti.find((c) => c.id === id)?.ref ?? null
  const refProjektu = (id?: string) => o.projekty.find((p) => p.id === id)?.ref ?? null
  const den = DNY[new Date(`${k.dnes}T12:00:00Z`).getUTCDay()]
  const radky = [
    `dnes: ${k.dnes} (${den})`,
    '',
    'klienti:',
    ...o.klienti.map((c) => `${c.ref}: ${c.jmeno.slice(0, LIMITY.jmeno)}`),
    '',
    'projekty:',
    ...o.projekty.map(
      (p) => `${p.ref}: ${p.jmeno.slice(0, LIMITY.jmeno)} (klient ${refKlienta(p.klientId) ?? '?'})`,
    ),
    '',
    'lidé:',
    ...o.lide.map((l) => `${l.ref}: ${l.jmeno.slice(0, LIMITY.jmeno)}`),
    '',
    'parser vytáhl:',
    JSON.stringify({
      nazev: parser.nazev,
      klient: refKlienta(parser.klientId),
      projekt: refProjektu(parser.projektId),
      termin: parser.termin ?? null,
      cas: parser.cas ?? null,
      priorita: parser.priorita ?? null,
    }),
    '',
    'původní text:',
    zadani.slice(0, LIMITY.zadani),
  ]
  return radky.join('\n')
}

const jeDatum = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined
  const t = v.replace(/\s+/g, ' ').trim()
  return t && t.length <= max ? t : undefined
}

/**
 * Odpověď modelu → návrh, který smí do appky.
 *
 * Každé pole se ověřuje samo a co neprojde, se zahodí — neplatný odkaz
 * neshodí celý návrh, jen to jedno pole. Projekt musí patřit klientovi
 * (vybranému modelem, jinak parserem) a jeho klient se pak bere s ním,
 * jinak by úkol visel v projektu cizího klienta. Termín v minulosti se
 * nebere: „do pátku" řečené v sobotu je chyba výpočtu, ne přání.
 */
export function ocisti(raw: unknown, parser: Parser, k: Kontext): Navrh {
  if (!raw || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  const o = odkazy(k)
  const out: Navrh = {}

  const nazev = text(r.nazev, LIMITY.nazev)
  if (nazev && nazev !== parser.nazev) out.nazev = nazev

  const klient = o.klienti.find((c) => c.ref === r.klient)
  if (klient) out.klientId = klient.id

  const projekt = o.projekty.find((p) => p.ref === r.projekt)
  const klientProjektu = out.klientId ?? parser.klientId
  if (projekt && (!klientProjektu || projekt.klientId === klientProjektu)) {
    out.projektId = projekt.id
    out.klientId = projekt.klientId
  }

  if (typeof r.termin === 'string' && jeDatum(r.termin) && r.termin >= k.dnes) out.termin = r.termin
  if (typeof r.cas === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.cas)) out.cas = r.cas
  if (typeof r.priorita === 'string' && (PRIORITY as readonly string[]).includes(r.priorita)) {
    out.priorita = r.priorita as Priorita
  }

  const komu = o.lide.find((l) => l.ref === r.komu)
  if (komu) out.komu = komu.id

  if (Array.isArray(r.kroky)) {
    const kroky = r.kroky
      .map((s) => text(s, LIMITY.krok))
      .filter((s): s is string => Boolean(s))
      .slice(0, LIMITY.kroku)
    if (kroky.length >= 2) out.kroky = kroky
  }

  // Co se shoduje s parserem, není návrh — jen by se to znovu nabízelo.
  if (out.klientId === parser.klientId) delete out.klientId
  if (out.projektId === parser.projektId) delete out.projektId
  if (out.termin === parser.termin) delete out.termin
  if (out.cas === parser.cas) delete out.cas
  if (out.priorita === (parser.priorita ?? 'normal')) delete out.priorita
  return out
}

/** Klíč mezipaměti: tentýž vstup = tatáž odpověď, i z druhého zařízení. */
export function klic(zadani: string, parser: Parser, k: Kontext): string {
  return JSON.stringify([zadani, parser, k.dnes, k.klienti, k.projekty, k.lide])
}

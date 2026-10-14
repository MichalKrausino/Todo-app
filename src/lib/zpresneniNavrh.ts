// Zpřesnění zadání úkolu modelem — čistá logika s testy.
//
// Návrh píše rutina Claude Code na předplatném (supabase/rutina-zpresneni.md)
// a ukládá ho do databáze tak, jak ho model napsal; tady se čistí, než
// ho appka nabídne. Žádná síť — testuje to vitest (`zpresneniNavrh.test.ts`).
//
// Model nedostává id z databáze, ale krátké odkazy (k1, p2, l1). Dlouhé
// uuid se špatně opisují a každý přepsaný znak je odkaz, který nikam
// nevede; krátký odkaz se buď trefí do seznamu, nebo se zahodí. Seznamy
// s id v pořadí odkazů si server ukládá k odpovědi (`vstup.kontext`),
// takže se dají přeložit zpátky (`navrhZRadku`).

export type Priorita = 'low' | 'normal' | 'high' | 'critical'

export interface Kontext {
  /**
   * Den, kdy člověk úkol napsal (v Praze, `YYYY-MM-DD`) — relativní data
   * („v pátek") se počítají od něj, ne ode dne, kdy se k tomu rutina dostala.
   */
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

/** Krátké odkazy pro model a cesta zpátky na id. */
export function odkazy(k: Kontext) {
  const klienti = k.klienti.slice(0, LIMITY.klientu).map((c, i) => ({ ref: `k${i + 1}`, ...c }))
  const projekty = k.projekty.slice(0, LIMITY.projektu).map((p, i) => ({ ref: `p${i + 1}`, ...p }))
  const lide = k.lide.slice(0, LIMITY.lidi).map((l, i) => ({ ref: `l${i + 1}`, ...l }))
  return { klienti, projekty, lide }
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

// Pořadí v seznamu JE odkaz (k1 = první klient), takže se vadný prvek
// nesmí jen vynechat — všechny za ním by se posunuly a „k3" by ukázalo
// na jiného klienta. Jeden vadný prvek proto znehodnotí celý seznam.
const seznam = <T,>(x: unknown, max: number, ok: (o: Record<string, unknown>) => boolean): T[] | null => {
  if (!Array.isArray(x)) return null
  const vsechnyOk = x.every((o) => Boolean(o) && typeof o === 'object' && ok(o as Record<string, unknown>))
  return vsechnyOk ? (x.slice(0, max) as T[]) : null
}

const retezec = (v: unknown): v is string => typeof v === 'string' && v.length > 0

/**
 * Řádek od rutiny → návrh, který smí do appky.
 *
 * Server si ke každé odpovědi uložil, co model dostal (`vstup`: parser
 * a seznamy s id v pořadí odkazů); odpověď je syrová, s odkazy k1/p2/l1.
 * Překlad i čištění dělá `ocisti` — stejně jako dřív, jen se nevolá na
 * serveru, ale tady. Rozbitý vstup znamená prázdný návrh, ne pád.
 */
export function navrhZRadku(vstup: unknown, odpoved: unknown): Navrh {
  if (!vstup || typeof vstup !== 'object') return {}
  const v = vstup as { parser?: unknown; kontext?: unknown }
  const p = v.parser as Record<string, unknown> | undefined
  const k = v.kontext as Record<string, unknown> | undefined
  if (!p || typeof p !== 'object' || typeof p.nazev !== 'string') return {}
  if (!k || typeof k !== 'object' || typeof k.dnes !== 'string') return {}
  const parser: Parser = {
    nazev: p.nazev,
    klientId: retezec(p.klientId) ? p.klientId : undefined,
    projektId: retezec(p.projektId) ? p.projektId : undefined,
    termin: retezec(p.termin) ? p.termin : undefined,
    cas: retezec(p.cas) ? p.cas : undefined,
    priorita: PRIORITY.find((x) => x === p.priorita),
  }
  const klienti = seznam<Kontext['klienti'][number]>(k.klienti, LIMITY.klientu, (o) => retezec(o.id) && retezec(o.jmeno))
  const projekty = seznam<Kontext['projekty'][number]>(k.projekty, LIMITY.projektu, (o) => retezec(o.id) && retezec(o.jmeno) && retezec(o.klientId))
  const lide = seznam<Kontext['lide'][number]>(k.lide, LIMITY.lidi, (o) => retezec(o.id) && retezec(o.jmeno))
  if (!klienti || !projekty || !lide) return {}
  const kontext: Kontext = { dnes: k.dnes, klienti, projekty, lide }
  return ocisti(odpoved, parser, kontext)
}

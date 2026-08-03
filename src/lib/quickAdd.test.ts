import { describe, expect, it } from 'vitest'
import { parseQuickAdd, parseTemplateItem } from './quickAdd'

// Středa 29. 7. 2026
const TODAY = new Date(2026, 6, 29)
const CLIENTS = [
  { id: 'c1', name: 'Klient X' },
  { id: 'c2', name: 'Acme' },
]

describe('parseQuickAdd', () => {
  it('rozpozná den v týdnu, klienta i prioritu', () => {
    const r = parseQuickAdd('ve čtvrtek poslat report @klientx !vysoká', CLIENTS, TODAY)
    expect(r.title).toBe('poslat report')
    expect(r.dueDate).toBe('2026-07-30')
    expect(r.clientId).toBe('c1')
    expect(r.priority).toBe('high')
  })

  it('funguje bez diakritiky', () => {
    const r = parseQuickAdd('ve ctvrtek report !vysoka', CLIENTS, TODAY)
    expect(r.dueDate).toBe('2026-07-30')
    expect(r.priority).toBe('high')
    expect(r.title).toBe('report')
  })

  it('rozpozná zítra a pozítří', () => {
    expect(parseQuickAdd('zítra zavolat Petrovi', [], TODAY).dueDate).toBe('2026-07-30')
    expect(parseQuickAdd('pozítří fakturace', [], TODAY).dueDate).toBe('2026-07-31')
    expect(parseQuickAdd('zítra zavolat Petrovi', [], TODAY).title).toBe('zavolat Petrovi')
  })

  it('rozpozná „za X dní“ číslem i slovem', () => {
    expect(parseQuickAdd('za 3 dny fakturace', [], TODAY).dueDate).toBe('2026-08-01')
    expect(parseQuickAdd('za tři dny fakturace', [], TODAY).dueDate).toBe('2026-08-01')
    expect(parseQuickAdd('za dva týdny revize', [], TODAY).dueDate).toBe('2026-08-12')
  })

  it('rozpozná numerické datum a roluje do dalšího roku', () => {
    expect(parseQuickAdd('15.9. návrh landing page', [], TODAY).dueDate).toBe('2026-09-15')
    expect(parseQuickAdd('1.2. revize strategie', [], TODAY).dueDate).toBe('2027-02-01')
    expect(parseQuickAdd('15. 9. návrh', [], TODAY).dueDate).toBe('2026-09-15')
    expect(parseQuickAdd('24.12.2026 dárky', [], TODAY).dueDate).toBe('2026-12-24')
  })

  it('rozpozná příští týden a příští pátek', () => {
    expect(parseQuickAdd('příští týden strategie', [], TODAY).dueDate).toBe('2026-08-03')
    expect(parseQuickAdd('příští pátek oběd', [], TODAY).dueDate).toBe('2026-08-07')
  })

  it('víkendové dny v akuzativu', () => {
    expect(parseQuickAdd('v sobotu úklid', [], TODAY).dueDate).toBe('2026-08-01')
    expect(parseQuickAdd('v neděli plán týdne', [], TODAY).dueDate).toBe('2026-08-02')
  })

  it('bez tokenů vrátí čistý inbox úkol', () => {
    const r = parseQuickAdd('koupit mléko', CLIENTS, TODAY)
    expect(r.title).toBe('koupit mléko')
    expect(r.dueDate).toBeUndefined()
    expect(r.clientId).toBeUndefined()
    expect(r.priority).toBe('normal')
  })

  it('neznámý @klient zůstane v názvu', () => {
    const r = parseQuickAdd('poslat @nikdo report', CLIENTS, TODAY)
    expect(r.clientId).toBeUndefined()
    expect(r.title).toBe('poslat @nikdo report')
  })

  it('klienta pozná i podle prefixu', () => {
    expect(parseQuickAdd('report @kli', CLIENTS, TODAY).clientId).toBe('c1')
    expect(parseQuickAdd('report @acme', CLIENTS, TODAY).clientId).toBe('c2')
  })

  it('dnešní den v týdnu znamená dnes', () => {
    expect(parseQuickAdd('ve středu standup', [], TODAY).dueDate).toBe('2026-07-29')
  })

  it('rozpozná „každý pátek" jako opakování s termínem na nejbližší pátek', () => {
    const r = parseQuickAdd('každý pátek kontrola kampaní', [], TODAY)
    expect(r.recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=FR')
    expect(r.dueDate).toBe('2026-07-31')
    expect(r.title).toBe('kontrola kampaní')
  })

  it('rozpozná každý den / měsíc a intervaly', () => {
    expect(parseQuickAdd('každý den standup', [], TODAY).recurrenceRule).toBe('FREQ=DAILY')
    expect(parseQuickAdd('každý měsíc report', [], TODAY).recurrenceRule).toBe('FREQ=MONTHLY;BYMONTHDAY=29')
    expect(parseQuickAdd('každých 14 dní fakturace', [], TODAY).recurrenceRule).toBe('FREQ=DAILY;INTERVAL=14')
    expect(parseQuickAdd('každé 2 týdny plánování', [], TODAY).recurrenceRule).toBe(
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=WE',
    )
  })

  it('bez „každý" se opakování nenastaví', () => {
    expect(parseQuickAdd('v pátek report', [], TODAY).recurrenceRule).toBeUndefined()
  })

  it('rozpozná datum s měsícem slovem', () => {
    expect(parseQuickAdd('15. srpna návrh', [], TODAY).dueDate).toBe('2026-08-15')
    expect(parseQuickAdd('15 srpna návrh', [], TODAY).dueDate).toBe('2026-08-15')
    expect(parseQuickAdd('1. února revize', [], TODAY).dueDate).toBe('2027-02-01')
    expect(parseQuickAdd('24. prosince 2026 dárky', [], TODAY).dueDate).toBe('2026-12-24')
    expect(parseQuickAdd('15. srpna návrh', [], TODAY).title).toBe('návrh')
  })

  it('rozpozná „do pátku" a další genitivy', () => {
    expect(parseQuickAdd('do pátku poslat fakturu', [], TODAY).dueDate).toBe('2026-07-31')
    expect(parseQuickAdd('do čtvrtka podklady', [], TODAY).dueDate).toBe('2026-07-30')
    expect(parseQuickAdd('do pátku poslat fakturu', [], TODAY).title).toBe('poslat fakturu')
  })

  it('rozpozná víkend a koncem týdne/měsíce', () => {
    expect(parseQuickAdd('o víkendu úklid', [], TODAY).dueDate).toBe('2026-08-01')
    expect(parseQuickAdd('na víkend výlet', [], TODAY).dueDate).toBe('2026-08-01')
    expect(parseQuickAdd('příští víkend chata', [], TODAY).dueDate).toBe('2026-08-08')
    expect(parseQuickAdd('koncem týdne shrnutí', [], TODAY).dueDate).toBe('2026-07-31')
    expect(parseQuickAdd('koncem měsíce fakturace', [], TODAY).dueDate).toBe('2026-07-31')
  })

  it('rozpozná příští měsíc a „za měsíc"', () => {
    expect(parseQuickAdd('příští měsíc strategie', [], TODAY).dueDate).toBe('2026-08-01')
    expect(parseQuickAdd('za měsíc kontrola', [], TODAY).dueDate).toBeUndefined() // „za měsíc" bez čísla neumíme
    expect(parseQuickAdd('za 2 měsíce revize', [], TODAY).dueDate).toBe('2026-09-29')
  })

  it('rozpozná hovorové dneska/zejtra', () => {
    expect(parseQuickAdd('dneska standup', [], TODAY).dueDate).toBe('2026-07-29')
    expect(parseQuickAdd('zejtra volat', [], TODAY).dueDate).toBe('2026-07-30')
  })

  it('!! a !!! jako zkratky priority', () => {
    expect(parseQuickAdd('poslat report !!', [], TODAY).priority).toBe('high')
    expect(parseQuickAdd('hasit kampaň !!!', [], TODAY).priority).toBe('critical')
    expect(parseQuickAdd('poslat report !!', [], TODAY).title).toBe('poslat report')
    // slovní priorita má přednost
    expect(parseQuickAdd('report !nízká', [], TODAY).priority).toBe('low')
  })

  it('poznámka za „//" jde do notes a neparsuje se', () => {
    const r = parseQuickAdd('zítra poslat report @acme // čísla vzít z GA4, zítra ne', CLIENTS, TODAY)
    expect(r.title).toBe('poslat report')
    expect(r.dueDate).toBe('2026-07-30')
    expect(r.clientId).toBe('c2')
    expect(r.notes).toBe('čísla vzít z GA4, zítra ne')
    // URL v textu poznámku nespustí
    expect(parseQuickAdd('přečíst https://example.com/x', [], TODAY).notes).toBeUndefined()
  })

  it('#projekt přiřadí projekt a doplní klienta', () => {
    const projects = [
      { id: 'p1', name: 'Web redesign', clientId: 'c2' },
      { id: 'p2', name: 'Kampaň léto', clientId: 'c1' },
    ]
    const r = parseQuickAdd('nakódovat hero #webredesign', CLIENTS, TODAY, projects)
    expect(r.projectId).toBe('p1')
    expect(r.clientId).toBe('c2')
    expect(r.title).toBe('nakódovat hero')
    // prefix stačí; projekt zadaného klienta má přednost
    const r2 = parseQuickAdd('banery @klientx #kamp', CLIENTS, TODAY, projects)
    expect(r2.projectId).toBe('p2')
    expect(r2.clientId).toBe('c1')
  })

  it('parseTemplateItem: položka šablony přirozeným jazykem', () => {
    const r = parseTemplateItem('každé pondělí kontrola kampaní !vysoká #PPC', TODAY)
    expect(r.title).toBe('kontrola kampaní')
    expect(r.recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=MO')
    expect(r.priority).toBe('high')
    expect(r.projectName).toBe('PPC')
    // #token si drží původní diakritiku a velikost písmen
    expect(parseTemplateItem('každý den standup #Sítě', TODAY).projectName).toBe('Sítě')
    // bez opakování se pravidlo nevrací — UI si řekne o doplnění
    expect(parseTemplateItem('kontrola kampaní', TODAY).recurrenceRule).toBeUndefined()
  })

  it('každý všední den a výčet dnů', () => {
    const r = parseQuickAdd('každý všední den standup', [], TODAY)
    expect(r.recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')
    expect(r.dueDate).toBe('2026-07-29')
    const r2 = parseQuickAdd('každé pondělí a čtvrtek publikovat post', [], TODAY)
    expect(r2.recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=MO,TH')
    expect(r2.dueDate).toBe('2026-07-30') // čtvrtek je z Wed nejblíž
    expect(r2.title).toBe('publikovat post')
  })

  it('čas „do 14:00" — čas bez dne znamená dnešek', () => {
    const r = parseQuickAdd('zavolat Pepovi do 14:00', [], TODAY)
    expect(r.title).toBe('zavolat Pepovi')
    expect(r.dueTime).toBe('14:00')
    expect(r.dueDate).toBe('2026-07-29')
  })

  it('čas se kombinuje s datem i klientem', () => {
    const r = parseQuickAdd('zítra v 9:30 poslat report @acme', CLIENTS, TODAY)
    expect(r.title).toBe('poslat report')
    expect(r.dueDate).toBe('2026-07-30')
    expect(r.dueTime).toBe('09:30')
    expect(r.clientId).toBe('c2')
  })

  it('tvary „ve 14h" a „v 9 hod"', () => {
    expect(parseQuickAdd('ve 14h brief', [], TODAY).dueTime).toBe('14:00')
    expect(parseQuickAdd('v 9 hod brief', [], TODAY).dueTime).toBe('09:00')
    expect(parseQuickAdd('ve 14h brief', [], TODAY).title).toBe('brief')
  })

  it('denní doby: ráno, poledne, večer', () => {
    expect(parseQuickAdd('zítra ráno zavolat', [], TODAY).dueTime).toBe('09:00')
    expect(parseQuickAdd('oběd v poledne', [], TODAY).dueTime).toBe('12:00')
    expect(parseQuickAdd('do večera odeslat podklady', [], TODAY).dueTime).toBe('19:00')
    expect(parseQuickAdd('zítra ráno zavolat', [], TODAY).title).toBe('zavolat')
  })

  it('nesmyslný čas se ignoruje a slova s časem uvnitř nechytá', () => {
    expect(parseQuickAdd('kód 25:99 doplnit', [], TODAY).dueTime).toBeUndefined()
    // „večeře" není „večer" — titulek zůstává celý
    const r = parseQuickAdd('koupit suroviny na večeři', [], TODAY)
    expect(r.dueTime).toBeUndefined()
    expect(r.title).toBe('koupit suroviny na večeři')
  })
})

// Deterministické id. Tenhle test je pojistka proti tiché katastrofě:
// id se počítá na OBOU zařízeních zvlášť a spoléhá se, že vyjde totéž.
// Kdyby se změnil hash, oddělovač nebo formát, obě zařízení by od té
// chvíle generovala jiná id — sync by z každého výskytu šablony udělal
// duplikát a tombstone smazaného by nesedl na nic. Nic by nespadlo,
// jen by se seznamy začaly zdvojovat.
//
// Proto se tu porovnávají KONKRÉTNÍ hodnoty, ne jen „je to stabilní":
// vlastnostní test by přežil i změnu algoritmu.

import { describe, expect, it } from 'vitest'
import { deterministicUuid } from './deterministicId'

describe('deterministické id', () => {
  it('pro tytéž části vrátí tutéž hodnotu', async () => {
    const a = await deterministicUuid('tpl', 'c1', 'i1', '2026-09-14')
    const b = await deterministicUuid('tpl', 'c1', 'i1', '2026-09-14')
    expect(a).toBe(b)
  })

  it('drží přesně tyhle hodnoty — změna algoritmu je rozbití syncu', async () => {
    // Tvary, které appka opravdu počítá (viz templates.ts, repo.ts).
    expect(await deterministicUuid('tpl', 'c1', 'i1', '2026-09-14')).toBe(
      '15bb254b-3ab4-5aa1-a00c-3c1737e4a677',
    )
    expect(await deterministicUuid('respawn', 't1', '2026-09-21')).toBe(
      '496334db-bfb6-505c-868d-e08810080d58',
    )
    expect(await deterministicUuid('followup', 'ev1', '2026-09-14')).toBe(
      'bfdeb39e-9c92-5593-a6cb-34dd8017ee0a',
    )
  })

  it('má tvar UUIDv5 (verze 5, varianta RFC 4122)', async () => {
    const id = await deterministicUuid('cokoliv')
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('jiné části dají jiné id', async () => {
    const a = await deterministicUuid('tpl', 'c1', 'i1', '2026-09-14')
    const b = await deterministicUuid('tpl', 'c1', 'i1', '2026-09-15')
    const c = await deterministicUuid('tpl', 'c2', 'i1', '2026-09-14')
    expect(new Set([a, b, c]).size).toBe(3)
  })

  it('části odděluje nulový bajt — přeskupení hranic mění výsledek', async () => {
    // Kdyby se části jen slepily bez oddělovače, ('ab','c') a ('a','bc')
    // by daly totéž a dva různé výskyty by sdílely jedno id.
    expect(await deterministicUuid('ab', 'c')).not.toBe(await deterministicUuid('a', 'bc'))
    // A oddělovač je opravdu NUL, ne mezera: kdyby se změnil na mezeru,
    // tahle dvojice by splynula s tou výš a všechna stará id by přestala
    // sedět. Hodnota je proto přibitá i sem.
    expect(await deterministicUuid('ab', 'c')).toBe('dbdd4f85-d8a5-5500-aa5c-9c8a0d456f96')
  })

  it('zvládne diakritiku i prázdné části', async () => {
    await expect(deterministicUuid('tpl', 'Ondra Fréz', '')).resolves.toMatch(/^[0-9a-f-]{36}$/)
  })
})

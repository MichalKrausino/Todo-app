import { describe, expect, it } from 'vitest'
import { isDue, wokeUp } from './freshness'

const base = { now: 1_000_000, intervalMs: 60_000, online: true, visible: true }

describe('isDue', () => {
  it('co ještě neběželo, běží hned', () => {
    expect(isDue({ ...base })).toBe(true)
  })

  it('uvnitř intervalu se neopakuje', () => {
    expect(isDue({ ...base, lastAt: base.now - 30_000 })).toBe(false)
  })

  it('po intervalu zase ano', () => {
    expect(isDue({ ...base, lastAt: base.now - 60_000 })).toBe(true)
  })

  it('bez signálu nikdy', () => {
    expect(isDue({ ...base, online: false })).toBe(false)
  })

  it('na pozadí nikdy — appka stejně spí', () => {
    expect(isDue({ ...base, visible: false })).toBe(false)
  })
})

describe('wokeUp', () => {
  it('normální tik není probuzení', () => {
    expect(wokeUp(1_000_000, 1_030_000, 30_000)).toBe(false)
  })

  it('dlouhá pauza je probuzení ze spánku', () => {
    expect(wokeUp(1_000_000, 1_000_000 + 10 * 60_000, 30_000)).toBe(true)
  })

  it('první tik po startu se za probuzení nepovažuje', () => {
    expect(wokeUp(undefined, 1_000_000, 30_000)).toBe(false)
  })
})

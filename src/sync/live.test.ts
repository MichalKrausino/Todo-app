// Plánovač čerstvosti. Testuje se s falešnými timery a stubem prohlížeče —
// vrstvy pod ním (sync, kalendář, Todoist) jsou zamockované, takže se
// ověřuje jenom to, KDY se co zavolá.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const listeners = new Map<string, () => void>()

const def = (name: string, value: unknown) =>
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })

def('document', {
  visibilityState: 'visible',
  addEventListener: (t: string, f: () => void) => listeners.set(`doc:${t}`, f),
})
def('navigator', {
  onLine: true,
  connection: { addEventListener: (t: string, f: () => void) => listeners.set(`conn:${t}`, f) },
})
def('window', { addEventListener: (t: string, f: () => void) => listeners.set(`win:${t}`, f) })

vi.mock('./engine', () => ({ syncNow: vi.fn(async () => {}) }))
vi.mock('./calendar', () => ({
  maybeRefreshCalendar: vi.fn(async () => {}),
  refreshCalendar: vi.fn(async () => {}),
}))
vi.mock('./todoist', () => ({
  maybeRefreshTodoist: vi.fn(async () => {}),
  refreshTodoist: vi.fn(async () => {}),
}))

const { syncNow } = await import('./engine')
const { maybeRefreshCalendar, refreshCalendar } = await import('./calendar')
const { maybeRefreshTodoist, refreshTodoist } = await import('./todoist')
const { initLive, stopLive } = await import('./live')

const setOnline = (v: boolean) => {
  ;(globalThis.navigator as unknown as { onLine: boolean }).onLine = v
}
const setVisible = (v: boolean) => {
  ;(globalThis.document as unknown as { visibilityState: string }).visibilityState = v
    ? 'visible'
    : 'hidden'
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  setOnline(true)
  setVisible(true)
  initLive()
})

afterEach(() => {
  stopLive()
  vi.useRealTimers()
})

describe('plánovač čerstvosti', () => {
  it('drží vlastní data čerstvá po minutách', async () => {
    await vi.advanceTimersByTimeAsync(30_000)
    expect(syncNow).toHaveBeenCalledTimes(1) // první tik: ještě neběželo
    await vi.advanceTimersByTimeAsync(30_000)
    expect(syncNow).toHaveBeenCalledTimes(1) // minuta ještě neuplynula
    await vi.advanceTimersByTimeAsync(30_000)
    expect(syncNow).toHaveBeenCalledTimes(2)
  })

  it('kalendář a Todoist se ptají při každém tiku (cadenci si hlídají samy)', async () => {
    await vi.advanceTimersByTimeAsync(60_000)
    expect(maybeRefreshCalendar).toHaveBeenCalledTimes(2)
    expect(maybeRefreshTodoist).toHaveBeenCalledTimes(2)
  })

  it('bez signálu se nezkouší nic', async () => {
    setOnline(false)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(syncNow).not.toHaveBeenCalled()
    expect(maybeRefreshCalendar).not.toHaveBeenCalled()
  })

  it('na pozadí se netahá — od toho jsou push notifikace', async () => {
    setVisible(false)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(syncNow).not.toHaveBeenCalled()
  })

  it('návrat signálu stáhne všechno hned, bez čekání na interval', async () => {
    listeners.get('win:online')?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(syncNow).toHaveBeenCalledTimes(1)
    expect(refreshCalendar).toHaveBeenCalledTimes(1)
    expect(refreshTodoist).toHaveBeenCalledWith(true)
  })

  it('přepnutí wifi ↔ data taky', async () => {
    listeners.get('conn:change')?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(refreshTodoist).toHaveBeenCalledWith(true)
  })

  it('návrat do popředí stáhne hned', async () => {
    listeners.get('doc:visibilitychange')?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(syncNow).toHaveBeenCalledTimes(1)
  })

  it('po probuzení zařízení se netaktuje po intervalech, ale tahá se rovnou', async () => {
    vi.setSystemTime(Date.now() + 20 * 60_000) // telefon spal 20 minut
    await vi.advanceTimersByTimeAsync(30_000)
    expect(refreshCalendar).toHaveBeenCalledTimes(1)
    expect(refreshTodoist).toHaveBeenCalledWith(true)
  })
})

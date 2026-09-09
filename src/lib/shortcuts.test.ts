import { describe, expect, it } from 'vitest'
import { zkratkaZKlavesy, zkratkyProNapovedu, type Klavesa, type Kontext } from './shortcuts'

const k = (key: string, mods: Partial<Klavesa> = {}): Klavesa => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
})
const klid: Kontext = { piseSe: false, panel: false, zadavani: false }

describe('zkratkaZKlavesy', () => {
  it('⌘K i Ctrl+K hledá, i při psaní', () => {
    expect(zkratkaZKlavesy(k('k', { metaKey: true }), klid)).toBe('hledat')
    expect(zkratkaZKlavesy(k('K', { ctrlKey: true, shiftKey: true }), { ...klid, piseSe: true })).toBe('hledat')
  })

  it('jednopísmenné zkratky jen mimo pole a bez modifikátorů', () => {
    expect(zkratkaZKlavesy(k('n'), klid)).toBe('novy')
    expect(zkratkaZKlavesy(k('/'), klid)).toBe('hledat')
    expect(zkratkaZKlavesy(k('2'), klid)).toBe('plan')
    expect(zkratkaZKlavesy(k('n'), { ...klid, piseSe: true })).toBeNull()
    expect(zkratkaZKlavesy(k('n', { metaKey: true }), klid)).toBeNull()
    expect(zkratkaZKlavesy(k('1', { altKey: true }), klid)).toBeNull()
  })

  it('s otevřeným panelem nedělá nic — klávesy patří panelu', () => {
    expect(zkratkaZKlavesy(k('k', { metaKey: true }), { ...klid, panel: true })).toBeNull()
    expect(zkratkaZKlavesy(k('Escape'), { ...klid, panel: true, zadavani: true })).toBeNull()
  })

  it('Escape složí rozbalené zadávání, jinak ho nechá být', () => {
    expect(zkratkaZKlavesy(k('Escape'), { ...klid, zadavani: true, piseSe: true })).toBe('zavrit')
    expect(zkratkaZKlavesy(k('Escape'), klid)).toBeNull()
  })

  it('nápověda píše ⌘ na Macu a Ctrl jinde', () => {
    expect(zkratkyProNapovedu(true)[0].klavesy).toBe('⌘ K')
    expect(zkratkyProNapovedu(false)[0].klavesy).toBe('Ctrl K')
  })
})

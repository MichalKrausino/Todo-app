// Záložky doku — pilulka, která jede pod prstem.
//
// Vlastní práce, inspirace: tab bar v iOS 26 (Liquid Glass — pilulka se
// dá chytit a přetáhnout, ikony pod ní nadskakují), Family app, Arc.
// Dřív pilulka jen přeskočila pružinou z ikony na ikonu (layoutId).
// Teď: (1) ťuknutí ji nechá doletět pružinou jako dřív; (2) když prst
// na doku zůstane a táhne, pilulka se odlepí a jede s ním — pružina za
// prstem lehce zaostává, takže pohyb má váhu, a podle rychlosti se
// roztahuje do strany (želé: scaleX podle rychlosti, scaleY dorovnává
// objem); (3) ikona, kolem které pilulka zrovna projíždí, se nadme;
// (4) puštění vybere záložku nejblíž prstu a pilulka na ni dosedne.
//
// Mechanika: pointer events + pointer capture na celém pásu (stejná
// lekce jako u panelu — touchmove.preventDefault Safari neposlouchá),
// `touch-action: none`, protože pás nic neroluje. S pointer capture
// prohlížeč pošle `click` pásu, ne tlačítku — výběr proto dělá
// pointerup sám; onClick na tlačítkách zůstává pro klávesnici (Enter,
// mezerník) a je idempotentní. Polohy ikon se měří při každém stisku
// a při změně velikosti, ne při renderu — dok se zvětšuje pod kurzorem
// (Dock z magicui) a šířka pásu závisí na klávesnici.
//
// Klidový režim: pilulka skáče bez pružiny, nic se neroztahuje ani
// nenadýmá — audit chování počítá běžící animace.

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { motion, useMotionValue, useSpring, useTransform, useVelocity, type MotionValue } from 'motion/react'
import { klidovyRezim } from '../lib/motion'

// Průměr pilulky (= ikona doku v klidu).
const PILULKA = 40
// Kolik pixelů je ještě ťuknutí; nad tím se pilulka odlepí od záložky.
const PRAH_TAHU = 6

type Kontext = {
  registruj: (id: string, el: HTMLElement | null) => void
  /** střed pilulky vůči pásu — pro nadmutí ikony, kolem které projíždí */
  stred: MotionValue<number>
  klid: boolean
}
const Ctx = createContext<Kontext | null>(null)

export function DokZalozky({
  value,
  onChange,
  children,
  className,
}: {
  value: string
  onChange: (id: string) => void
  children: ReactNode
  className?: string
}) {
  const klid = klidovyRezim()
  const pas = useRef<HTMLDivElement>(null)
  const ikony = useRef(new Map<string, HTMLElement>())
  const registruj = (id: string, el: HTMLElement | null) => {
    if (el) ikony.current.set(id, el)
    else ikony.current.delete(id)
  }

  // Cíl pilulky (levý okraj vůči pásu) — pružina za ním jede.
  const cil = useMotionValue(0)
  const pruzina = useSpring(cil, { stiffness: 520, damping: 38, mass: 0.7 })
  const x = klid ? cil : pruzina
  // Želé: podle rychlosti se pilulka roztáhne do strany a o to zploští.
  const rychlost = useVelocity(x)
  const scaleX = useTransform(rychlost, [-3000, 0, 3000], [1.22, 1, 1.22])
  const scaleY = useTransform(scaleX, (s) => 1 / Math.sqrt(s))
  const stred = useTransform(x, (v) => v + PILULKA / 2)

  // Střed ikony vůči pásu.
  const stredIkony = (id: string): number | null => {
    const el = ikony.current.get(id)
    const p = pas.current
    if (!el || !p) return null
    const r = el.getBoundingClientRect()
    const rp = p.getBoundingClientRect()
    return r.left - rp.left + r.width / 2
  }
  const dosedni = () => {
    const s = stredIkony(value)
    if (s !== null) cil.set(s - PILULKA / 2)
  }
  // Při vybrání a při změně šířky pásu pilulka dosedne na svou záložku;
  // poprvé bez letu (jump), aby nepřijela z levého okraje.
  const poprve = useRef(true)
  useLayoutEffect(() => {
    const s = stredIkony(value)
    if (s === null) return
    if (poprve.current || klid) {
      cil.jump(s - PILULKA / 2)
      pruzina.jump(s - PILULKA / 2)
      poprve.current = false
    } else cil.set(s - PILULKA / 2)
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const p = pas.current
    if (!p || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const s = stredIkony(value)
      if (s !== null) {
        cil.jump(s - PILULKA / 2)
        pruzina.jump(s - PILULKA / 2)
      }
    })
    ro.observe(p)
    return () => ro.disconnect()
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  // Gesto: stisk → (tah: pilulka jede s prstem) → puštění vybere nejbližší.
  const tah = useRef<{ id: number; x0: number; tahne: boolean } | null>(null)
  const [tahne, setTahne] = useState(false)
  const nejblizsi = (clientX: number): string | null => {
    const p = pas.current
    if (!p) return null
    const px = clientX - p.getBoundingClientRect().left
    let best: string | null = null
    let bestD = Infinity
    for (const id of ikony.current.keys()) {
      const s = stredIkony(id)
      if (s === null) continue
      const d = Math.abs(s - px)
      if (d < bestD) {
        bestD = d
        best = id
      }
    }
    return best
  }
  const naPas = (clientX: number) => {
    const p = pas.current
    if (!p) return 0
    const r = p.getBoundingClientRect()
    const ids = [...ikony.current.keys()]
    const kraje = ids.map(stredIkony).filter((v): v is number => v !== null)
    const min = Math.min(...kraje)
    const max = Math.max(...kraje)
    return Math.min(max, Math.max(min, clientX - r.left)) - PILULKA / 2
  }
  const stisk = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    tah.current = { id: e.pointerId, x0: e.clientX, tahne: false }
    pas.current?.setPointerCapture(e.pointerId)
  }
  const pohyb = (e: React.PointerEvent) => {
    const t = tah.current
    if (!t || t.id !== e.pointerId) return
    if (!t.tahne) {
      if (Math.abs(e.clientX - t.x0) < PRAH_TAHU) return
      t.tahne = true
      setTahne(true)
    }
    cil.set(naPas(e.clientX))
  }
  const pusteni = (e: React.PointerEvent) => {
    const t = tah.current
    if (!t || t.id !== e.pointerId) return
    tah.current = null
    setTahne(false)
    const id = nejblizsi(e.clientX)
    if (id) {
      if (id === value) dosedni()
      else onChange(id)
    }
  }
  const zrusit = () => {
    tah.current = null
    setTahne(false)
    dosedni()
  }

  return (
    <Ctx.Provider value={{ registruj, stred, klid }}>
      <div
        ref={pas}
        className={`relative ${className ?? ''}`}
        style={{ touchAction: 'none' }}
        onPointerDown={stisk}
        onPointerMove={pohyb}
        onPointerUp={pusteni}
        onPointerCancel={zrusit}
        data-pas=""
        data-tahne={tahne ? 'true' : undefined}
      >
        <motion.span
          aria-hidden="true"
          className="tab-on pointer-events-none absolute left-0 top-1/2 rounded-full"
          style={{
            x,
            scaleX: klid ? 1 : scaleX,
            scaleY: klid ? 1 : scaleY,
            width: PILULKA,
            height: PILULKA,
            marginTop: -PILULKA / 2,
          }}
        />
        {children}
      </div>
    </Ctx.Provider>
  )
}

// Ikona záložky: hlásí svou polohu pásu, nadme se, když kolem ní jede
// pilulka, a při vybrání poskočí (stlačit → přestřelit → dosednout).
export function DokZalozka({ id, on, children }: { id: string; on: boolean; children: ReactNode }) {
  const ctx = useContext(Ctx)
  const ref = useRef<HTMLSpanElement>(null)
  const registruj = ctx?.registruj
  useLayoutEffect(() => {
    registruj?.(id, ref.current)
    return () => registruj?.(id, null)
  }, [id, registruj])
  const fallback = useMotionValue(0)
  const nadmuti = useTransform(ctx?.stred ?? fallback, (s: number) => {
    const el = ref.current
    const p = el?.parentElement
    if (!el || !p || ctx?.klid) return 1
    // vzdálenost středu pilulky od středu ikony, v jednotkách šířky záložky
    const r = el.getBoundingClientRect()
    const rp = el.closest('[data-pas]')?.getBoundingClientRect()
    if (!rp) return 1
    const d = Math.abs(s - (r.left - rp.left + r.width / 2))
    const dosah = 56
    return d >= dosah ? 1 : 1 + 0.14 * (1 - d / dosah)
  })
  return (
    <motion.span ref={ref} style={{ scale: nadmuti }} className="relative block h-[60%] w-[60%]">
      {ctx?.klid ? (
        <span className="block h-full w-full">{children}</span>
      ) : (
        <motion.span
          key={on ? 'on' : 'off'}
          className="block h-full w-full"
          initial={on ? { scale: 0.86 } : false}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', bounce: 0.55, duration: 0.55 }}
        >
          {children}
        </motion.span>
      )}
    </motion.span>
  )
}

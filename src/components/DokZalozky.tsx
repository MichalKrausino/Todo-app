// Záložky doku — pilulka, která jede pod prstem.
//
// Vlastní práce, inspirace: tab bar v iOS 26 (Liquid Glass — pilulka se
// dá chytit a přetáhnout, ikony pod ní nadskakují), Family app, Arc.
// Dřív pilulka jen přeskočila pružinou z ikony na ikonu (layoutId).
// Teď: (1) ťuknutí ji pošle jako KAPKU — hrana ve směru jízdy vyrazí
// hned, zadní o chvíli později, čočka se mezi záložkami natáhne do
// dlouhé kapsle a na cíli se stáhne kolem ikony; k tomu se nadzvedne a
// rozsvítí a ikona pod ní se lehce přitáhne (lom skla); (2) když prst
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
import { animate, motion, useMotionValue, useSpring, useTransform, useVelocity, type MotionValue } from 'motion/react'
import { klidovyRezim } from '../lib/motion'

// Čočka pod vybranou záložkou: širší než ikona, skoro na výšku doku —
// jako tab bar v iOS 26 (a GitHub či Instagram, které ho přebraly).
const PILULKA = 64
const PILULKA_V = 44
// Zdvih při přepnutí: čočka se nadzvedne, přejede a dosedne.
const ZDVIH_MS = 480
// Kapka: přední hrana čočky vyrazí hned, zadní o tolik později — mezi
// záložkami se čočka natáhne do dlouhé kapsle a na cíli se zase stáhne.
const ZADNI_HRANA_MS = 90
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

  // Čočka má dvě hrany a každá má vlastní pružinu. Při přepnutí vyrazí
  // hrana ve směru jízdy hned a druhá o chvíli později (ZADNI_HRANA_MS),
  // takže se čočka mezi záložkami natáhne jako kapka a na cíli se zase
  // stáhne kolem ikony — místo tuhého kotouče, který jen přejede.
  const levyCil = useMotionValue(0)
  const pravyCil = useMotionValue(PILULKA)
  const pruzinaCfg = { stiffness: 540, damping: 36, mass: 0.7 }
  const levyPruzina = useSpring(levyCil, pruzinaCfg)
  const pravyPruzina = useSpring(pravyCil, pruzinaCfg)
  const levy = klid ? levyCil : levyPruzina
  const pravy = klid ? pravyCil : pravyPruzina
  const sirka = useTransform([levy, pravy], ([l, r]: number[]) => Math.max(PILULKA * 0.6, r - l))
  const stred = useTransform([levy, pravy], ([l, r]: number[]) => (l + r) / 2)
  // Rychlost středu: čím rychleji čočka letí, tím víc se zploští (objem
  // zůstává v natažení do délky).
  const rychlost = useVelocity(stred)
  const zplosteni = useTransform(rychlost, [-3000, 0, 3000], [0.9, 1, 0.9])
  // Zdvih: při přepnutí se čočka nadzvedne (1 → 1.1 → 1), jako by se
  // odlepila od skla, přejela a zase dosedla.
  const zdvih = useMotionValue(1)
  const scaleY = useTransform([zdvih, zplosteni], ([z, p]: number[]) => z * p)
  const [leti, setLeti] = useState(false)
  const zadniHrana = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Poslat čočku na střed `s`: hned obě hrany (tah, klid), nebo jako
  // kapku — přední hrana teď, zadní za chvíli.
  const posli = (s: number, kapka: boolean) => {
    const l = s - PILULKA / 2
    const r = s + PILULKA / 2
    if (zadniHrana.current) clearTimeout(zadniHrana.current)
    if (!kapka) {
      levyCil.set(l)
      pravyCil.set(r)
      return
    }
    const doprava = s > stred.get()
    if (doprava) {
      pravyCil.set(r)
      zadniHrana.current = setTimeout(() => levyCil.set(l), ZADNI_HRANA_MS)
    } else {
      levyCil.set(l)
      zadniHrana.current = setTimeout(() => pravyCil.set(r), ZADNI_HRANA_MS)
    }
  }
  const skoc = (s: number) => {
    levyCil.jump(s - PILULKA / 2)
    pravyCil.jump(s + PILULKA / 2)
    levyPruzina.jump(s - PILULKA / 2)
    pravyPruzina.jump(s + PILULKA / 2)
  }

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
    if (s !== null) posli(s, false)
  }
  // Při vybrání a při změně šířky pásu čočka dosedne na svou záložku;
  // poprvé bez letu (jump), aby nepřijela z levého okraje.
  const poprve = useRef(true)
  useLayoutEffect(() => {
    const s = stredIkony(value)
    if (s === null) return
    if (poprve.current || klid) {
      skoc(s)
      poprve.current = false
      return
    }
    posli(s, true)
    // Let: zdvih + jas na dobu přejezdu.
    setLeti(true)
    const a = animate(zdvih, [1, 1.1, 1], { duration: ZDVIH_MS / 1000, ease: [0.3, 0, 0.2, 1], times: [0, 0.35, 1] })
    const t = setTimeout(() => setLeti(false), ZDVIH_MS)
    return () => {
      a.stop()
      clearTimeout(t)
    }
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  // Hlídač šířky pásu se zakládá JEDNOU. Dřív visel na `value` a při
  // každém přepnutí se založil znovu — a ResizeObserver po `observe`
  // zavolá callback hned, takže čočka skočila na cíl dřív, než pružina
  // vyrazila; let nebyl nikdy vidět. První zavolání se přeskočí (polohu
  // při montáži řeší layout effect výš), aktuální záložka se čte z ref.
  const valueRef = useRef(value)
  valueRef.current = value
  useEffect(() => {
    const p = pas.current
    if (!p || typeof ResizeObserver === 'undefined') return
    let prvni = true
    const ro = new ResizeObserver(() => {
      if (prvni) {
        prvni = false
        return
      }
      const s = stredIkony(valueRef.current)
      if (s !== null) skoc(s)
    })
    ro.observe(p)
    return () => ro.disconnect()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
    return Math.min(max, Math.max(min, clientX - r.left))
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
    posli(naPas(e.clientX), false)
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
        data-leti={leti ? 'true' : undefined}
      >
        <motion.span
          aria-hidden="true"
          className="tab-on pointer-events-none absolute left-0 top-1/2 rounded-full"
          style={{
            x: levy,
            width: sirka,
            scaleY: klid ? 1 : scaleY,
            height: PILULKA_V,
            marginTop: -PILULKA_V / 2,
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
  // Vzdálenost středu čočky od středu ikony (kladná = čočka je vpravo).
  const odstup = useTransform(ctx?.stred ?? fallback, (s: number) => {
    const el = ref.current
    if (!el || ctx?.klid) return Infinity
    const r = el.getBoundingClientRect()
    const rp = el.closest('[data-pas]')?.getBoundingClientRect()
    if (!rp) return Infinity
    return s - (r.left - rp.left + r.width / 2)
  })
  const DOSAH = 64
  const nadmuti = useTransform(odstup, (d: number) => {
    const a = Math.abs(d)
    return a >= DOSAH ? 1 : 1 + 0.12 * (1 - a / DOSAH)
  })
  // Lom: ikona pod sklem se o pár pixelů přitáhne k čočce, když projíždí
  // kolem — obraz pod čočkou se posouvá s ní.
  const lom = useTransform(odstup, (d: number) => {
    const a = Math.abs(d)
    if (a >= DOSAH) return 0
    return Math.sign(d) * 3 * Math.sin((Math.PI * a) / DOSAH)
  })
  return (
    <motion.span ref={ref} style={{ scale: nadmuti, x: lom }} className="relative block h-[60%] w-[60%]">
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

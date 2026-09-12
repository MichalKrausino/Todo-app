// Záložky doku — čočka, která se zvedne, překlouže a dosedne.
//
// Vlastní práce. Předloha: tab bar v iOS 26 (Liquid Glass — kapsle pod
// vybranou záložkou se dá chytit a přetáhnout, sklo při pohybu chytá
// světlo), přechod `replace.downUp` u SF Symbols (stará ikona klesne,
// nová vyjede zespoda) a zásady E. Kowalského (stisk 0,9 jako okamžitá
// odezva, pružina místo keyframes, protože se dá přerušit v půlce).
// Dřív čočka letěla jako kapka — natahovala se mezi záložkami; působilo
// to hravě, ne přesně. Teď má pohyb tři fáze a nic se nedeformuje:
//
//  1. STISK — ikona pod prstem se stlačí (0,9) hned při dotyku, ještě
//     než se cokoli vybere. Appka odpovídá na prst, ne až na puštění.
//  2. ZDVIH A KLOUZÁNÍ — po puštění se čočka nadzvedne (1,07, stín se
//     prodlouží, sklo zesvětlá) a jednou pružinou překlouže k cíli:
//     tuhost 400, tlumení 32 — rychlý rozjezd, dlouhé měkké dobrždění,
//     přestřelení pod pixel. Během jízdy po ní přejede ODLESK — pruh
//     světla stojí ve světě, ne na skle, takže se vůči čočce posouvá
//     proti směru jízdy (poloha z rychlosti, jas z rychlosti), a v klidu
//     zmizí. Ikony, kolem kterých čočka jede, se pod sklem lehce
//     nadzvednou a přitáhnou (lom), vybraná ikona klesne (0,94, +2 px).
//  3. DOSEDNUTÍ — zdvih se povolí, až když se čočka opravdu zastaví
//     (rychlost pod prahem), ne po stopkách; stín se stáhne, sklo
//     ztmavne zpět. Nová ikona vyjede zespoda (+5 px, 0,88 → 1) pružinou
//     s malým odrazem, o 120 ms po vzletu — ve chvíli, kdy na ni čočka
//     dojíždí, takže to vypadá, že ji sklo zvedlo.
//
// Tah prstem zůstává: čočka se odlepí, jede za prstem s lehkým
// zpožděním pružiny a puštění vybere nejbližší záložku.
//
// Mechanika: pointer events + pointer capture na celém pásu (stejná
// lekce jako u panelu — touchmove.preventDefault Safari neposlouchá),
// `touch-action: none`, protože pás nic neroluje. S pointer capture
// prohlížeč pošle `click` pásu, ne tlačítku — výběr proto dělá
// pointerup sám; onClick na tlačítkách zůstává pro klávesnici (Enter,
// mezerník) a je idempotentní. Polohy ikon se měří při každém stisku
// a při změně velikosti, ne při renderu — dok se zvětšuje pod kurzorem
// (Dock z magicui) a šířka pásu závisí na klávesnici. ResizeObserver
// se zakládá JEDNOU (první zavolání se přeskočí) — když visel na
// `value`, jeho okamžité první zavolání čočku skočilo na cíl dřív, než
// pružina vyrazila, a let nebyl nikdy vidět.
//
// Klidový režim: čočka skáče bez pružiny, nic se nezvedá ani nesvítí —
// audit chování počítá běžící animace.

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { animate, motion, useMotionValue, useSpring, useTransform, useVelocity, type MotionValue } from 'motion/react'
import { klidovyRezim } from '../lib/motion'
import { vyhodnotStisk, type Stisk } from '../lib/dvojklik'

// Čočka pod vybranou záložkou: širší než ikona, skoro na výšku doku —
// jako tab bar v iOS 26 (a GitHub či Instagram, které ho přebraly).
const PILULKA = 64
const PILULKA_V = 44
// O kolik se čočka při jízdě nadzvedne.
const ZDVIH = 1.07
// Pod touto rychlostí (px/s) čočka „stojí" a smí dosednout…
const PRAH_KLIDU = 30
// …ale ne dřív než tolik ms po vzletu — pružina se teprve rozjíždí.
const ROZJEZD_MS = 90
// Pojistka: dosednout nejpozději za tolik ms, i kdyby rychlost nešla číst.
const LET_MAX_MS = 900
// Pulz: zdvih a přejezd odlesku, když se změní POLOHA vybrané záložky
// (Dnes ⇄ Vše). Čočka nikam nejede, takže se nemá o co opřít odlesk
// tažený rychlostí — dostane vlastní průjezd. 380 ms je tak akorát:
// ikona vyjíždí zespoda 550 ms pružinou se zpožděním 120, sklo má
// dosednout dřív, než se dokreslí podpis.
const PULZ_MS = 380
// Kolik pixelů je ještě ťuknutí; nad tím se čočka odlepí od záložky.
const PRAH_TAHU = 6

type Kontext = {
  registruj: (id: string, el: HTMLElement | null) => void
  /**
   * Střed ikony vůči pásu — ČTE SE Z CACHE, neměří se.
   * Dřív si ho každá ikona počítala uvnitř `useTransform`, tedy při každém
   * snímku pohybu čočky: tři ikony × dvě `getBoundingClientRect` × 60 fps,
   * proložené zápisy stylů = vynucený přepočet rozvržení. V profilu
   * přepnutí záložky to byla nejdražší položka vůbec (65 ms vlastního času,
   * víc než všechny funkce appky dohromady). Poloha ikony přitom na pohybu
   * čočky vůbec nezávisí — mění se jen se ZMĚNOU ROZVRŽENÍ, a tu hlásí
   * `ResizeObserver` (pás i jednotlivé ikony, kvůli zvětšování pod kurzorem)
   * plus přeměření při stisku.
   */
  stredIkony: (id: string) => number | null
  /** střed čočky vůči pásu — pro ikony, kolem kterých projíždí */
  stred: MotionValue<number>
  /** zdvih čočky 1…ZDVIH — ikony se pod letícím sklem nadzvednou */
  zdvih: MotionValue<number>
  /** záložka, na které zrovna leží prst */
  stisknuto: string | null
  klid: boolean
}
const Ctx = createContext<Kontext | null>(null)

const sevri = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/** Střed prvku vůči levé hraně pásu v nezmenšených pixelech (viz stredIkony). */
function stredVuciPasu(el: Element, p: HTMLElement): number {
  const r = el.getBoundingClientRect()
  const rp = p.getBoundingClientRect()
  const meritko = p.offsetWidth > 0 && rp.width > 0 ? rp.width / p.offsetWidth : 1
  return (r.left - rp.left + r.width / 2) / meritko
}

export function DokZalozky({
  value,
  onChange,
  onReselect,
  poloha,
  children,
  className,
}: {
  value: string
  onChange: (id: string) => void
  // Dvojité ťuknutí na UŽ vybranou záložku — viz `src/lib/dvojklik.ts`.
  onReselect?: (id: string) => void
  // Poloha vybrané záložky (Dnes ⇄ Vše). Když se změní, aniž by se
  // změnila záložka, čočka to řekne pulzem — jinak by se obrazovka
  // přepnula a dok by o tom mlčel.
  poloha?: string
  children: ReactNode
  className?: string
}) {
  const klid = klidovyRezim()
  const pas = useRef<HTMLDivElement>(null)
  const ikony = useRef(new Map<string, HTMLElement>())
  // Změřené středy ikon. Přepočítávají se při změně rozvržení, ne za pohybu.
  const stredy = useRef(new Map<string, number>())
  // Hlídač velikosti JEDNOTLIVÝCH ikon: Dock z magicui je pod kurzorem
  // zvětšuje, čímž posune i své sousedy — a posun sám o sobě `ResizeObserver`
  // nespustí, proto se při každém hlášení přepočítají všechny.
  const roIkony = useRef<ResizeObserver | null>(null)
  const registruj = useCallback((id: string, el: HTMLElement | null) => {
    const stary = ikony.current.get(id)
    if (stary && stary !== el) roIkony.current?.unobserve(stary)
    if (el) {
      ikony.current.set(id, el)
      roIkony.current?.observe(el)
    } else {
      ikony.current.delete(id)
      stredy.current.delete(id)
    }
  }, [])

  // Poloha: jedna pružina na střed čočky. Tvar se nemění — šířka je
  // pevná, čočka jen klouže.
  const cil = useMotionValue(0)
  const pruzina = useSpring(cil, { stiffness: 400, damping: 32, mass: 0.85 })
  const stred = klid ? cil : pruzina
  const levy = useTransform(stred, (s: number) => s - PILULKA / 2)
  const rychlost = useVelocity(stred)
  // Zdvih: cíl 1 nebo ZDVIH, pružina mezi nimi — nadzvednutí je rychlé,
  // dosednutí měkké.
  const cilZdvihu = useMotionValue(1)
  const zdvih = useSpring(cilZdvihu, { stiffness: 420, damping: 30 })
  // Odlesk: světlo stojí ve světě, sklo pod ním jede — pruh se vůči
  // čočce posouvá proti směru jízdy a svítí jen v pohybu.
  const lesk = useTransform(rychlost, (v: number) => sevri(-v * 0.014, -22, 22))
  const leskJas = useTransform(rychlost, (v: number) => sevri(Math.abs(v) / 500, 0, 1))

  // Odlesk při pulzu: vlastní průjezd, protože čočka stojí a rychlost je
  // nula. Sečte se s tím, co dává let — nikdy neběží obojí naráz.
  const pulzX = useMotionValue(0)
  const pulzJas = useMotionValue(0)
  const leskX = useTransform([lesk, pulzX], ([a, b]: number[]) => a + b)
  const leskO = useTransform([leskJas, pulzJas], ([a, b]: number[]) => Math.max(a, b))

  const [leti, setLeti] = useState(false)
  const let_ = useRef<{ od: number; pojistka: ReturnType<typeof setTimeout> | null } | null>(null)
  const dosedni = () => {
    const l = let_.current
    if (!l) return
    if (l.pojistka) clearTimeout(l.pojistka)
    let_.current = null
    cilZdvihu.set(1)
    setLeti(false)
  }
  // Vzlet: nadzvednout a rozsvítit; dosedne se, až se čočka zastaví.
  const vzlet = () => {
    if (let_.current?.pojistka) clearTimeout(let_.current.pojistka)
    let_.current = { od: performance.now(), pojistka: setTimeout(dosedni, LET_MAX_MS) }
    cilZdvihu.set(ZDVIH)
    setLeti(true)
  }
  // Změna polohy vybrané záložky: zdvih v místě + jeden přejezd odlesku.
  // Žádná deformace — dok se nikdy neroztahuje, jen se nadzvedne a chytí
  // světlo, přesně jako když letí.
  const polohaRef = useRef(poloha)
  useEffect(() => {
    if (polohaRef.current === poloha) return
    polohaRef.current = poloha
    if (klid) return
    vzlet()
    const t = setTimeout(dosedni, PULZ_MS)
    pulzX.jump(-26)
    const a = animate(pulzX, 26, { duration: 0.42, ease: [0.3, 0, 0.2, 1] })
    const b = animate(pulzJas, [0, 1, 0], { duration: 0.42, times: [0, 0.45, 1], ease: 'easeOut' })
    return () => {
      clearTimeout(t)
      a.stop()
      b.stop()
      pulzJas.jump(0)
    }
  }, [poloha]) // eslint-disable-line react-hooks/exhaustive-deps

  const tahneRef = useRef(false)
  useEffect(
    () =>
      rychlost.on('change', (v) => {
        const l = let_.current
        if (!l || tahneRef.current) return
        if (performance.now() - l.od < ROZJEZD_MS) return
        if (Math.abs(v) < PRAH_KLIDU) dosedni()
      }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Střed ikony vůči pásu. Rect se dělí měřítkem pásu: dok při startu
  // přijíždí zmenšený (scale 0,94) a čočka se usazuje ještě během
  // nájezdu — bez přepočtu by z rectů vyšla poloha o 6 % blíž ke kraji
  // a čočka by po každém startu stála o 2 px vedle.
  // Přeměří VŠECHNY ikony naráz — jeden rect pásu na celou dávku místo
  // jednoho na ikonu. Volá se jen při změně rozvržení a při stisku.
  const preemer = () => {
    const p = pas.current
    if (!p) return
    const rp = p.getBoundingClientRect()
    const meritko = p.offsetWidth > 0 && rp.width > 0 ? rp.width / p.offsetWidth : 1
    for (const [id, el] of ikony.current) {
      const r = el.getBoundingClientRect()
      stredy.current.set(id, (r.left - rp.left + r.width / 2) / meritko)
    }
  }
  const stredIkony = (id: string): number | null => {
    const z = stredy.current.get(id)
    if (z !== undefined) return z
    // Ještě se neměřilo (první vykreslení) — změřit teď a zapamatovat.
    const el = ikony.current.get(id)
    const p = pas.current
    if (!el || !p) return null
    const v = stredVuciPasu(el, p)
    stredy.current.set(id, v)
    return v
  }
  const skoc = (s: number) => {
    cil.jump(s)
    pruzina.jump(s)
  }
  const naSvou = () => {
    const s = stredIkony(value)
    if (s !== null) cil.set(s)
  }
  // Při vybrání čočka překlouže na svou záložku; poprvé bez letu (jump),
  // aby nepřijela z levého okraje.
  const poprve = useRef(true)
  useLayoutEffect(() => {
    const s = stredIkony(value)
    if (s === null) return
    if (poprve.current || klid) {
      skoc(s)
      poprve.current = false
      return
    }
    vzlet()
    cil.set(s)
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  // Hlídač šířky pásu — jednou, viz hlavička.
  const valueRef = useRef(value)
  valueRef.current = value
  useEffect(() => {
    const p = pas.current
    if (!p || typeof ResizeObserver === 'undefined') return
    let prvni = true
    const ro = new ResizeObserver(() => {
      // Měřit VŽDYCKY — přeskakuje se jen skok čočky, ne obnova cache.
      preemer()
      if (prvni) {
        prvni = false
        return
      }
      const s = stredIkony(valueRef.current)
      if (s !== null) skoc(s)
    })
    ro.observe(p)
    // Vlastní hlídač na ikony: ten smí jen přeměřit. Kdyby sdílel `prvni`
    // s pásem, spotřeboval by ho svým okamžitým prvním hlášením a čočka by
    // po startu skočila na cíl dřív, než pružina vyrazí (přesně ta chyba,
    // kvůli které nebyl let nikdy vidět).
    roIkony.current = new ResizeObserver(() => preemer())
    for (const el of ikony.current.values()) roIkony.current.observe(el)
    return () => {
      ro.disconnect()
      roIkony.current?.disconnect()
      roIkony.current = null
      if (let_.current?.pojistka) clearTimeout(let_.current.pojistka)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Gesto: stisk (ikona se stlačí) → tah (čočka jede s prstem) →
  // puštění vybere nejbližší záložku.
  const tah = useRef<{ id: number; x0: number; tahne: boolean } | null>(null)
  // Poslední ťuknutí na vybranou záložku (kvůli dvojitému).
  const stisky = useRef<Stisk | null>(null)
  const [tahne, setTahne] = useState(false)
  const [stisknuto, setStisknuto] = useState<string | null>(null)
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
    const kraje = [...ikony.current.keys()].map(stredIkony).filter((v): v is number => v !== null)
    return sevri(clientX - r.left, Math.min(...kraje), Math.max(...kraje))
  }
  const stisk = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    // Pojistka proti zastaralé cache: stisk je lidské tempo, jedno
    // přeměření tu nic nestojí a gesto pak stojí na čerstvých polohách.
    preemer()
    tah.current = { id: e.pointerId, x0: e.clientX, tahne: false }
    pas.current?.setPointerCapture(e.pointerId)
    setStisknuto(nejblizsi(e.clientX))
  }
  const pohyb = (e: React.PointerEvent) => {
    const t = tah.current
    if (!t || t.id !== e.pointerId) return
    if (!t.tahne) {
      if (Math.abs(e.clientX - t.x0) < PRAH_TAHU) return
      t.tahne = true
      tahneRef.current = true
      setTahne(true)
      setStisknuto(null)
      if (!klid) vzlet()
    }
    cil.set(naPas(e.clientX))
  }
  const konecTahu = () => {
    tah.current = null
    tahneRef.current = false
    setTahne(false)
    setStisknuto(null)
  }
  const pusteni = (e: React.PointerEvent) => {
    const t = tah.current
    if (!t || t.id !== e.pointerId) return
    konecTahu()
    const id = nejblizsi(e.clientX)
    if (!id) return
    if (id === value) {
      // Zůstává, kde je: čočka jen dosedne zpátky na ikonu.
      if (let_.current) let_.current.od = performance.now()
      naSvou()
      // Druhé ťuknutí na tutéž vybranou záložku je vlastní gesto.
      const r = vyhodnotStisk(stisky.current, id, performance.now())
      stisky.current = r.stav
      if (r.dvojite) onReselect?.(id)
    } else {
      // Přepnutí počítadlo nuluje: rychlé Klienti → Dnes → Dnes není dvojité.
      stisky.current = null
      onChange(id)
    }
  }
  const zrusit = () => {
    konecTahu()
    if (let_.current) let_.current.od = performance.now()
    naSvou()
  }

  return (
    <Ctx.Provider value={{ registruj, stredIkony, stred, zdvih, stisknuto, klid }}>
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
          className="tab-on pointer-events-none absolute left-0 top-1/2 overflow-hidden rounded-full"
          style={{
            x: levy,
            scale: klid ? 1 : zdvih,
            width: PILULKA,
            height: PILULKA_V,
            marginTop: -PILULKA_V / 2,
          }}
        >
          {!klid && <motion.span className="tab-lesk" style={{ x: leskX, opacity: leskO }} />}
        </motion.span>
        {children}
      </div>
    </Ctx.Provider>
  )
}

// Ikona záložky: hlásí svou polohu pásu, stlačí se pod prstem, nadzvedne
// se, když kolem ní jede čočka, a při vybrání vyjede zespoda.
export function DokZalozka({
  id,
  on,
  podoba,
  children,
}: {
  id: string
  on: boolean
  // Identita kresby. Když se změní, aniž by se změnilo `on` (Dnes ⇄ Vše),
  // ikona se vymění týmž pohybem jako při vybrání — `replace.downUp`
  // u SF Symbols: stará zmizí, nová vyjede zespoda a dokreslí se tahem.
  podoba?: string
  children: ReactNode
}) {
  const ctx = useContext(Ctx)
  const ref = useRef<HTMLSpanElement>(null)
  const registruj = ctx?.registruj
  useLayoutEffect(() => {
    registruj?.(id, ref.current)
    return () => registruj?.(id, null)
  }, [id, registruj])
  const fallback = useMotionValue(0)
  const fallbackZdvih = useMotionValue(1)
  // Vzdálenost středu čočky od středu ikony (kladná = čočka je vpravo).
  // Jen odečtení dvou čísel. Dřív se tu při každém snímku prošel DOM
  // (`closest`) a četlo rozvržení (dva `getBoundingClientRect`) — poloha
  // ikony přitom na pohybu čočky nezávisí, viz `stredIkony` v kontextu.
  const stredIkony = ctx?.stredIkony
  const odstup = useTransform(ctx?.stred ?? fallback, (s: number) => {
    if (ctx?.klid || !stredIkony) return Infinity
    const c = stredIkony(id)
    return c === null ? Infinity : s - c
  })
  const DOSAH = 64
  const blizkost = useTransform(odstup, (d: number) => {
    const a = Math.abs(d)
    return a >= DOSAH ? 0 : 1 - a / DOSAH
  })
  // Stisk: 0,9 pod prstem, pružinou tam i zpět.
  const stisk = useSpring(useMotionValue(1), { stiffness: 600, damping: 32 })
  const stisknuto = ctx?.stisknuto === id && !ctx?.klid
  useEffect(() => {
    stisk.set(stisknuto ? 0.9 : 1)
  }, [stisknuto, stisk])
  // Pod čočkou je ikona o něco větší (sklo zvětšuje); pod LETÍCÍ čočkou
  // se navíc nadzvedne — v klidu stojí přesně na středu.
  const scale = useTransform([blizkost, stisk], ([b, s]: number[]) => (1 + 0.06 * b) * s)
  const y = useTransform([blizkost, ctx?.zdvih ?? fallbackZdvih], ([b, z]: number[]) => (-3 * b * (z - 1)) / (ZDVIH - 1))
  // První vykreslení se nerozjíždí: dok při startu vyjíždí zespoda celý
  // a ikona, která si k tomu přidá vlastní nájezd, z něj vypadne.
  const prvniPodoba = useRef(true)
  useEffect(() => {
    prvniPodoba.current = false
  }, [])
  // Lom: obraz pod sklem se o pár pixelů přitáhne k čočce.
  const lom = useTransform(odstup, (d: number) => {
    const a = Math.abs(d)
    if (a >= DOSAH) return 0
    return Math.sign(d) * 2 * Math.sin((Math.PI * a) / DOSAH)
  })
  return (
    <motion.span ref={ref} style={{ scale, x: lom, y }} className="relative block h-[60%] w-[60%]">
      {ctx?.klid ? (
        <span className="block h-full w-full">{children}</span>
      ) : (
        // `key` na podobě: výměna kresby při stejné záložce musí pohyb
        // přehrát znovu. Motion spouští `animate` jen při změně hodnoty
        // a ta je pokaždé stejný literál — bez remountu by nová ikona
        // jen tiše probliskla a podpis by se nedokreslil.
        <motion.span
          key={podoba}
          className="block h-full w-full"
          initial={prvniPodoba.current ? false : { y: 5, scale: 0.88, opacity: 0 }}
          animate={
            on
              ? { y: [5, 0], scale: [0.88, 1], opacity: [0.6, 1] }
              : { y: [0, 2, 0], scale: [1, 0.94, 1], opacity: 1 }
          }
          transition={
            on
              ? { type: 'spring', bounce: 0.4, duration: 0.55, delay: 0.12, opacity: { duration: 0.2, delay: 0.12 } }
              : { duration: 0.22, ease: [0.3, 0, 0.2, 1] }
          }
        >
          {children}
        </motion.span>
      )}
    </motion.span>
  )
}

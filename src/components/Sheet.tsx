import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Společný spodní panel: nájezd zdola (ease-ios), animované zavření —
// panel sjede dolů a backdrop se prolne, teprve pak se odmontuje.
// Děti dostávají close(), aby i tlačítka zavírala s animací; Escape
// funguje na Macu. Zavírání řídí třída .closing na backdropu (index.css).
// Renderuje se portálem do <body>, aby push-back transform obsahu
// (.app-shell v index.css) nerozbil fixed pozici panelu. Cenou za ten
// portál je, že panel stojí MIMO .app-shell, a tím i mimo obal, který se
// sám drží viditelného obdélníku — proto `inset-x-0` a svislé rozměry
// z `--vv-top`/`--vvh` v index.css, ne `inset-0`. S `inset-0` seděl panel
// na spodní hraně STRÁNKY, tedy pod otevřenou klávesnicí: z detailu úkolu
// zbyla na displeji jen hlavička a pole, do kterého se zrovna psalo, bylo
// schované. Strop výšky je `--sheet-max` (App.tsx) — nad klávesnicí celá
// výška, jinak 90 %, ať je za panelem vidět kus appky.
//
// Odsazení zdola bere `--dock-safe`, ne `env(safe-area-inset-bottom)`
// přímo: nad klávesnicí žádná domovní lišta není a safe-area by z něj
// udělala prázdný pruh mezi tlačítky a klávesnicí.

// Zásobník otevřených panelů — Escape smí zavřít jen ten navrchu.
// Bez něj by jedno stisknutí zavřelo i vyhledávání pod detailem úkolu.
const stack: symbol[] = []

// Klávesové zkratky appky (src/lib/shortcuts.ts) mlčí, dokud nad ní leží
// panel — klávesy tam patří jemu.
export const jeOtevrenyPanel = () => stack.length > 0

// Stažení panelu dolů ho zavře — na iPhonu to člověk zkusí jako první.
//
// POSTAVENO PODLE OVĚŘENÉHO VZORU (vaul, drawer od Emila Kowalského),
// protože vlastní vynález tady dvakrát selhal:
//
//   1. ÚCHYT jede na pointer events. Má `touch-action: none`, takže mu
//      prohlížeč gesto nevezme, a pointer capture drží události u něj,
//      i když prst vyjede jinam.
//   1b. PLOCHA PANELU jede na touch events, a jinak to nejde. Změřeno:
//      při tahu na rolovací ploše přijde `pointercancel` UŽ PO PRVNÍM
//      pohybu — a přijde i tehdy, když je panel odrolovaný nahoře
//      a `overscroll-behavior: none`, tedy když není co odrolovat.
//      Prohlížeč si svislý tah bere tak jako tak a jediné, co ho
//      zastaví, je `preventDefault` v non-passive `touchmove`.
//      Ten se volá JEN když se stejně nedá rolovat (panel nahoře, tah
//      dolů): nikdy tedy nesebere gesto, které by něco odrolovalo,
//      a když ho Safari nevyslyší — od iOS 15 `preventDefault` v
//      touchmove neposlouchá, jakmile se rolování jednou rozjede —
//      zůstane chování jako dřív, ne rozbité.
//      Bez toho tahu za plochu prst na obsahu spustil pružné přetažení
//      vlastního rolování: obsah uvnitř sjel dolů, krabice zůstala stát
//      a nad úchytem se otevřela prázdná plocha v barvě panelu.
//   2. Poloha se zapisuje jako obyčejný inline `transform`. Šlo to jen
//      proto, že panel už nemá CSS animaci s `fill: both` — ta v kaskádě
//      inline styl přebíjela a panel se prstem nehnul ani o pixel.
//      Nájezd i sjezd teď dělá přechod (viz .sheet-panel v index.css).
//   3. Při puštění se inline transform prostě smaže a zbytek dojede CSS:
//      zpátky nahoru, nebo dolů, když panel zavírá. Žádné dopočítávání
//      polohy, ze kterého má animace začít.
//
// Táhne se jen tehdy, když je panel odrolovaný úplně nahoře — jinak by
// gesto sebralo scrollování obsahu. Zavře se po dostatečné dráze NEBO při
// rychlém švihnutí; krátké lízmutí panel vrátí zpátky.
const ZAVRIT_PX = 120
const ZAVRIT_RYCHLOST = 0.5 // px/ms

export function Sheet({
  onClose,
  tone = 'card',
  className = '',
  children,
}: {
  onClose: () => void
  tone?: 'card' | 'paper'
  className?: string
  children: (close: () => void) => React.ReactNode
}) {
  const [closing, setClosing] = useState(false)
  // Přechod potřebuje dvě různé hodnoty ve dvou snímcích: panel se
  // namontuje dole (translateY(100%)) a teprve dalším snímkem dostane
  // třídu `open`. Bez toho by naskočil rovnou nahoře, bez nájezdu.
  const [otevreno, setOtevreno] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const uchytRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // onClose bývá inline lambda (mění identitu každým renderem rodiče) —
  // ref drží aktuální callback a close zůstává stabilní, takže překreslení
  // rodiče během zavírací animace nezruší čekající timer (visící overlay).
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const close = useCallback(() => {
    setClosing(true)
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => onCloseRef.current(), 300)
  }, [])

  useEffect(() => () => clearTimeout(closeTimer.current), [])

  useEffect(() => {
    const id = requestAnimationFrame(() => setOtevreno(true))
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    const me = Symbol('sheet')
    stack.push(me)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stack[stack.length - 1] === me) close()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      const i = stack.indexOf(me)
      if (i !== -1) stack.splice(i, 1)
    }
  }, [close])

  // Nativní listenery schválně: React by je navěsil na kořen, a tady je
  // potřeba mít je přímo na panelu (pointer capture, non-passive touchmove).
  useEffect(() => {
    const panel = panelRef.current
    const uchyt = uchytRef.current
    if (!panel || !uchyt) return

    let zacatekX = 0
    let zacatekY = 0
    let posledniY = 0
    let posledniCas = 0
    let rychlost = 0
    let tahne = false
    let odshora = false
    let posun = 0
    // Dvě cesty ke stejnému gestu (úchyt přes pointer events, plocha přes
    // touch events) se nesmí potkat v jednom tahu a počítat rychlost dvakrát.
    let zdroj: 'uchyt' | 'plocha' | null = null

    const uklid = () => {
      tahne = false
      zdroj = null
      panel.style.transition = ''
      panel.style.overflowY = ''
    }

    const zacatek = (x: number, y: number, cas: number, kdo: 'uchyt' | 'plocha') => {
      zacatekX = x
      zacatekY = posledniY = y
      posledniCas = cas
      rychlost = 0
      posun = 0
      tahne = false
      zdroj = kdo
      // Když je obsah odrolovaný, patří první tah zpátky nahoru, ne na zavření.
      odshora = panel.scrollTop <= 0
    }

    /** Vrací true, když tah tímhle pohybem právě začal. */
    const posunuj = (x: number, y: number, cas: number): boolean => {
      const dy = y - zacatekY
      let zacalo = false
      if (!tahne) {
        // Svislé gesto musí převážit nad vodorovným, jinak by tažení po
        // posuvné řádce (barvy, rychlé dny) sebralo panel místo obsahu.
        if (!odshora || dy < 8 || dy <= Math.abs(x - zacatekX)) return false
        tahne = true
        zacalo = true
        // Po dobu tahu se nesmí rolovat ani přechodovat: rolování by pod
        // prstem gumovalo obsah, přechod by za prstem zpožďoval panel.
        panel.style.overflowY = 'hidden'
        panel.style.transition = 'none'
      }
      const dt = cas - posledniCas
      if (dt > 0) rychlost = (y - posledniY) / dt
      posledniY = y
      posledniCas = cas
      posun = Math.max(0, dy) // tažení nahoru není zavírání
      panel.style.transform = `translate3d(0, ${posun}px, 0)`
      return zacalo
    }

    const konec = () => {
      if (!tahne) {
        zdroj = null
        return
      }
      const prah = Math.min(ZAVRIT_PX, panel.offsetHeight * 0.25)
      const zavrit = posun > prah || rychlost > ZAVRIT_RYCHLOST
      uklid()
      // Inline poloha se smaže a zbytek dojede CSS přechod — nahoru zpátky,
      // nebo dolů, protože `close()` nasadí třídu `closing`.
      panel.style.transform = ''
      if (zavrit) close()
    }

    // pointercancel = rolování si vzal prohlížeč. Panel patří zpátky nahoru.
    const zruseno = () => {
      if (!tahne) {
        zdroj = null
        return
      }
      uklid()
      panel.style.transform = ''
    }

    // --- úchyt: pointer events (má `touch-action: none`, nikdo mu gesto nevezme)
    const pDown = (e: PointerEvent) => {
      // Myš tažení nepotřebuje — má Escape i klepnutí vedle.
      if (e.pointerType === 'mouse') return
      zacatek(e.clientX, e.clientY, e.timeStamp, 'uchyt')
    }
    const pMove = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || zdroj !== 'uchyt') return
      // Capture drží události u úchytu, i když prst vyjede jinam.
      if (posunuj(e.clientX, e.clientY, e.timeStamp)) uchyt.setPointerCapture(e.pointerId)
    }
    const pUp = () => {
      if (zdroj === 'uchyt') konec()
    }
    const pCancel = () => {
      if (zdroj === 'uchyt') zruseno()
    }

    // --- plocha panelu: touch events
    //
    // Pointer events tu nestačí. Změřeno: prohlížeč si svislý tah na rolovací
    // ploše vezme a pošle `pointercancel` UŽ PO PRVNÍM POHYBU — a dělá to
    // i tehdy, když je panel odrolovaný nahoře a `overscroll-behavior: none`,
    // tedy když není co odrolovat. Jediné, co mu v tom zabrání, je
    // `preventDefault` v non-passive `touchmove`.
    //
    // Ten se volá JEN když se stejně nedá rolovat: panel je nahoře a tah
    // míří dolů. Díky té podmínce nemůže vzít gesto, které by jinak něco
    // odrolovalo — a když ho Safari nevyslyší, zůstane chování jako dřív
    // (tah neudělá nic), ne rozbité.
    const zTextovehoPole = (t: EventTarget | null) =>
      t instanceof Element && t.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')

    const tStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || zdroj) return
      // Úchyt si gesto řeší sám přes pointer events.
      if (uchyt.contains(e.target as Node)) return
      // Nad textovým polem patří svislý tah kurzoru a výběru textu.
      if (zTextovehoPole(e.target)) return
      const t = e.touches[0]
      zacatek(t.clientX, t.clientY, e.timeStamp, 'plocha')
    }
    const tMove = (e: TouchEvent) => {
      if (zdroj !== 'plocha' || e.touches.length !== 1) return
      const t = e.touches[0]
      const dy = t.clientY - zacatekY
      // `preventDefault` musí čekat, až je jasné, že jde o SVISLÝ tah dolů.
      // Prevence platí na celé gesto, takže jedno ukvapené zavolání na první
      // ťuknutí by zabilo vodorovné rolování řádky chipů (sloty v detailu
      // úkolu, barvy, rychlé dny) — a ta uvnitř panelu je skoro všude.
      if (panel.scrollTop <= 0 && dy > 0 && dy >= Math.abs(t.clientX - zacatekX) && e.cancelable) {
        e.preventDefault()
      }
      posunuj(t.clientX, t.clientY, e.timeStamp)
    }
    const tEnd = () => {
      if (zdroj === 'plocha') konec()
    }
    const tCancel = () => {
      if (zdroj === 'plocha') zruseno()
    }

    uchyt.addEventListener('pointerdown', pDown)
    uchyt.addEventListener('pointermove', pMove)
    uchyt.addEventListener('pointerup', pUp)
    uchyt.addEventListener('pointercancel', pCancel)
    panel.addEventListener('touchstart', tStart, { passive: true })
    panel.addEventListener('touchmove', tMove, { passive: false })
    panel.addEventListener('touchend', tEnd)
    panel.addEventListener('touchcancel', tCancel)
    return () => {
      uchyt.removeEventListener('pointerdown', pDown)
      uchyt.removeEventListener('pointermove', pMove)
      uchyt.removeEventListener('pointerup', pUp)
      uchyt.removeEventListener('pointercancel', pCancel)
      panel.removeEventListener('touchstart', tStart)
      panel.removeEventListener('touchmove', tMove)
      panel.removeEventListener('touchend', tEnd)
      panel.removeEventListener('touchcancel', tCancel)
    }
  }, [close])

  return createPortal(
    <div
      className={`sheet-backdrop fixed inset-x-0 z-50 flex items-end justify-center bg-ink/35 backdrop-blur-[2px] ${
        closing ? 'closing' : otevreno ? 'open' : ''
      }`}
      onClick={close}
    >
      <div
        ref={panelRef}
        className={`sheet-panel max-h-[var(--sheet-max,90%)] w-full max-w-lg overflow-y-auto overflow-x-hidden overscroll-none rounded-t-[28px] p-4 shadow-sheet ${
          tone === 'paper' ? 'bg-paper' : 'bg-card'
        } ${className}`}
        style={{ paddingBottom: 'calc(1.5rem + var(--dock-safe, env(safe-area-inset-bottom)))' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Pruh na tažení. Musí být dost velký na prst a nesmí rolovat —
            `touch-action: none` v index.css je to jediné, co prohlížeči
            zabrání vzít si gesto jako rolování. */}
        <div ref={uchytRef} className="sheet-grip -mx-4 -mt-4 grid h-11 place-items-center">
          <span className="h-1 w-10 rounded-full bg-line" />
        </div>
        {children(close)}
      </div>
    </div>,
    document.body,
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Společný spodní panel: nájezd zdola (ease-ios), animované zavření —
// panel sjede dolů a backdrop se prolne, teprve pak se odmontuje.
// Děti dostávají close(), aby i tlačítka zavírala s animací; Escape
// funguje na Macu. Zavírání řídí třída .closing na backdropu (index.css).
// Renderuje se portálem do <body>, aby push-back transform obsahu
// (.app-shell v index.css) nerozbil fixed pozici panelu.
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
//   1. Pointer events, ne touch events. Safari od iOS 15 `preventDefault`
//      v touchmove spolehlivě neposlouchá, jakmile se jednou rozjede
//      rolování — stavět na něm gesto je stavba na písku. Pointer capture
//      naproti tomu drží události u panelu i mimo něj a `pointercancel`
//      poctivě řekne, že si scrollování vzal prohlížeč.
//   1b. TÁHNE SE ZA ÚCHYT NAHOŘE, ne za celou plochu panelu. Změřeno:
//      když gesto začne na rolovací ploše, prohlížeč si ho vezme po dvou
//      pohybech (přijde `pointercancel`) dřív, než se stihne rozpoznat —
//      a proti tomu nepomůže nic než `touch-action: none`, které by ale
//      na rolovací ploše zabilo rolování. Úchyt je proto samostatný pruh
//      nahoře, který nerolluje; přesně to slibuje ta čárka pod okrajem.
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

  // Nativní listenery schválně: React by `pointermove` navěsil na kořen,
  // a tady je potřeba mít je přímo na panelu kvůli pointer capture.
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

    const uklid = () => {
      tahne = false
      panel.style.transition = ''
      panel.style.overflowY = ''
    }

    const start = (e: PointerEvent) => {
      // Myš tažení nepotřebuje — má Escape i klepnutí vedle.
      if (e.pointerType === 'mouse') return
      zacatekX = e.clientX
      zacatekY = posledniY = e.clientY
      posledniCas = e.timeStamp
      rychlost = 0
      posun = 0
      tahne = false
      // Úchyt nerolluje, takže tahat jde vždycky — ale když je obsah
      // odrolovaný, patří první tah zpátky nahoru, ne na zavření.
      odshora = panel.scrollTop <= 0
    }

    const pohyb = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return
      const dy = e.clientY - zacatekY
      if (!tahne) {
        // Svislé gesto musí převážit nad vodorovným, jinak by tažení po
        // posuvné řádce (barvy, rychlé dny) sebralo panel místo obsahu.
        if (!odshora || dy < 8 || dy <= Math.abs(e.clientX - zacatekX)) return
        tahne = true
        // Capture drží události u úchytu, i když prst vyjede jinam.
        uchyt.setPointerCapture(e.pointerId)
        // Po dobu tahu se nesmí rolovat ani přechodovat: rolování by pod
        // prstem gumovalo obsah, přechod by za prstem zpožďoval panel.
        panel.style.overflowY = 'hidden'
        panel.style.transition = 'none'
      }
      const dt = e.timeStamp - posledniCas
      if (dt > 0) rychlost = (e.clientY - posledniY) / dt
      posledniY = e.clientY
      posledniCas = e.timeStamp
      posun = Math.max(0, dy) // tažení nahoru není zavírání
      panel.style.transform = `translate3d(0, ${posun}px, 0)`
    }

    const konec = () => {
      if (!tahne) return
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
      if (!tahne) return
      uklid()
      panel.style.transform = ''
    }

    uchyt.addEventListener('pointerdown', start)
    uchyt.addEventListener('pointermove', pohyb)
    uchyt.addEventListener('pointerup', konec)
    uchyt.addEventListener('pointercancel', zruseno)
    return () => {
      uchyt.removeEventListener('pointerdown', start)
      uchyt.removeEventListener('pointermove', pohyb)
      uchyt.removeEventListener('pointerup', konec)
      uchyt.removeEventListener('pointercancel', zruseno)
    }
  }, [close])

  return createPortal(
    <div
      className={`sheet-backdrop fixed inset-0 z-50 flex items-end justify-center bg-ink/35 backdrop-blur-[2px] ${
        closing ? 'closing' : otevreno ? 'open' : ''
      }`}
      onClick={close}
    >
      <div
        ref={panelRef}
        className={`sheet-panel max-h-[90dvh] w-full max-w-lg overflow-y-auto overflow-x-hidden overscroll-contain rounded-t-[28px] p-4 shadow-sheet ${
          tone === 'paper' ? 'bg-paper' : 'bg-card'
        } ${className}`}
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
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

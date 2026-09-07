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

// Stažení panelu dolů ho zavře — na iPhonu to člověk zkusí jako první.
// Dřív se tím jen přetáhl obsah uvnitř (gumový doraz Safari): panel zůstal
// stát, nad hlavičkou zela bílá díra a zavřít šlo jen ťuknutím vedle.
//
// Táhne se jen tehdy, když je panel odrolovaný úplně nahoře — jinak by
// gesto sebralo scrollování obsahu. Zavře se po dostatečné dráze NEBO při
// rychlém švihnutí; krátké lízmutí panel vrátí zpátky.
const ZAVRIT_PX = 120
const ZAVRIT_RYCHLOST = 0.5 // px/ms

const klidovyRezim = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

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
  const panelRef = useRef<HTMLDivElement>(null)
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

  // Nativní listenery schválně: React registruje touchmove jako passive,
  // takže by v něm preventDefault neprošel a Safari by pod prstem dál
  // gumově táhlo obsah.
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return

    let zacatekX = 0
    let zacatekY = 0
    let posledniY = 0
    let posledniCas = 0
    let rychlost = 0
    let tahne = false
    let odshora = false
    let posun = 0

    // Posun se píše i do proměnné, ze které vychází zavírací animace —
    // jinak by panel před sjetím dolů nejdřív skočil zpátky nahoru.
    const nastav = (px: number) => {
      posun = px
      panel.style.transform = px ? `translateY(${px}px)` : ''
      panel.style.setProperty('--sheet-drag', `${px}px`)
    }

    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      zacatekX = e.touches[0].clientX
      zacatekY = posledniY = e.touches[0].clientY
      posledniCas = e.timeStamp
      rychlost = 0
      tahne = false
      odshora = panel.scrollTop <= 0
      panel.style.transition = ''
    }

    const pohyb = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const y = e.touches[0].clientY
      const dy = y - zacatekY
      if (!tahne) {
        // Svislé gesto musí převážit nad vodorovným — jinak by tažení
        // po posuvné řádce (barvy, rychlé dny) sebralo panel místo obsahu.
        if (!odshora || dy < 8 || dy <= Math.abs(e.touches[0].clientX - zacatekX)) return
        tahne = true
        // Safari ignoruje preventDefault, jakmile jednou začne rolovat —
        // proto se scrollování na dobu tahu vypne úplně. Bez toho zůstane
        // pod prstem gumový doraz, který panel jen nafoukne a nezavře.
        panel.style.overflowY = 'hidden'
      }
      const dt = e.timeStamp - posledniCas
      if (dt > 0) rychlost = (y - posledniY) / dt
      posledniY = y
      posledniCas = e.timeStamp
      // Tažení nahoru není zavírání — panel zůstane, kde je.
      if (dy <= 0) {
        nastav(0)
        return
      }
      e.preventDefault()
      nastav(dy)
    }

    const konec = () => {
      if (!tahne) return
      tahne = false
      panel.style.overflowY = ''
      const prah = Math.min(ZAVRIT_PX, panel.offsetHeight * 0.25)
      if (posun > prah || rychlost > ZAVRIT_RYCHLOST) {
        close()
        return
      }
      if (!klidovyRezim()) panel.style.transition = 'transform 0.28s var(--ease-ios)'
      nastav(0)
      const uklid = () => {
        panel.style.transition = ''
        panel.removeEventListener('transitionend', uklid)
      }
      panel.addEventListener('transitionend', uklid)
    }

    panel.addEventListener('touchstart', start, { passive: true })
    panel.addEventListener('touchmove', pohyb, { passive: false })
    panel.addEventListener('touchend', konec)
    panel.addEventListener('touchcancel', konec)
    return () => {
      panel.removeEventListener('touchstart', start)
      panel.removeEventListener('touchmove', pohyb)
      panel.removeEventListener('touchend', konec)
      panel.removeEventListener('touchcancel', konec)
    }
  }, [close])

  return createPortal(
    <div
      className={`sheet-backdrop fixed inset-0 z-50 flex items-end justify-center bg-ink/35 backdrop-blur-[2px] ${closing ? 'closing' : ''}`}
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
        <div className="mx-auto h-1 w-10 rounded-full bg-line" />
        {children(close)}
      </div>
    </div>,
    document.body,
  )
}

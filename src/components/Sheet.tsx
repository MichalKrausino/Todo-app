import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Společný spodní panel: nájezd zdola (ease-ios), animované zavření —
// panel sjede dolů a backdrop se prolne, teprve pak se odmontuje.
// Děti dostávají close(), aby i tlačítka zavírala s animací; Escape
// funguje na Macu. Zavírání řídí třída .closing na backdropu (index.css).
// Renderuje se portálem do <body>, aby push-back transform obsahu
// (.app-shell v index.css) nerozbil fixed pozici panelu.
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  return createPortal(
    <div
      className={`sheet-backdrop fixed inset-0 z-50 flex items-end justify-center bg-ink/35 backdrop-blur-[2px] ${closing ? 'closing' : ''}`}
      onClick={close}
    >
      <div
        className={`sheet-panel max-h-[90dvh] w-full max-w-lg overflow-y-auto overflow-x-hidden rounded-t-[28px] p-4 shadow-sheet ${
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

// Jedno místo, kde se zprávy u doku vykreslují. Portál do <body>, protože
// push-back transform obsahu (`.app-shell`) by fixed pozici rozbil —
// stejný důvod jako u panelů.

import { useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { getToast, skryjToast, subscribeToast } from '../lib/toast'

export function ToastHost() {
  const { toast, odchazi } = useSyncExternalStore(subscribeToast, getToast)
  if (!toast) return null

  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-3"
      style={{ bottom: 'calc(var(--dock-h, 9rem) + var(--vv-bottom, 0px) + 0.75rem)' }}
      role="status"
    >
      <div
        // Klíč podle id: druhá zpráva hned po první musí znovu naskočit,
        // jinak by se objevila bez animace uprostřed odchodu té předchozí.
        key={toast.id}
        className={`${odchazi ? 'toast-out' : 'pop'} pointer-events-auto flex items-center gap-2 rounded-full bg-ink/90 py-1.5 pl-4 pr-1.5 shadow-float backdrop-blur`}
      >
        <span className="max-w-48 truncate text-[13px] text-paper">{toast.text}</span>
        {toast.akce.map((a) => (
          <button
            key={a.popisek}
            onClick={() => {
              // Napřed schovat: co zpráva nabízela, se právě stalo.
              skryjToast()
              a.kdyz()
            }}
            className="shrink-0 rounded-full bg-paper/15 px-3 py-1 text-[13px] font-semibold text-paper transition-transform duration-150 active:scale-95"
          >
            {a.popisek}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  )
}

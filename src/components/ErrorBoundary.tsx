import { Component, type ErrorInfo, type ReactNode } from 'react'

// React při chybě v renderu odmontuje CELÝ strom — bez téhle pojistky
// zbyla bílá obrazovka bez jediného vodítka. Přesně to se stalo, když
// z kalendáře dorazila schůzka bez času: Intl.DateTimeFormat.format()
// vyhodil RangeError a appka zmizela.
//
// Data jsou v IndexedDB, takže se pádem nic neztratí — jen je potřeba
// to říct nahlas a nabídnout cestu ven. Detail chyby je schovaný pod
// rozbalovátkem: na displeji telefonu nemá co dělat, ale při hlášení
// problému je k nezaplacení.
interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Pád při vykreslování:', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-paper px-6 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-wash text-danger">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 8v5M12 16.5v.5" />
            <circle cx="12" cy="12" r="9" />
          </svg>
        </span>
        <div>
          <h1 className="text-[19px] font-semibold text-ink">Něco se rozbilo</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Tvoje data jsou v pořádku — leží v zařízení a nikam se neztratila.
          </p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-card transition-transform duration-150 active:scale-95"
        >
          Zkusit znovu
        </button>
        <details className="mt-2 max-w-full text-left">
          <summary className="cursor-pointer text-xs text-ink-faint">Podrobnosti chyby</summary>
          <pre className="mt-2 max-h-40 overflow-auto rounded-xl bg-well px-3 py-2 text-[11px] leading-relaxed text-ink-soft">
            {error.message}
          </pre>
        </details>
      </div>
    )
  }
}

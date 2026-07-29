// Jednoduchý event bus: repo vrstva hlásí zápisy, synchronizační vrstva
// na ně reaguje (debounced push). Drží směr závislostí — repo neví nic o síti.

type Callback = () => void

const callbacks = new Set<Callback>()

export function onRepoWrite(cb: Callback): () => void {
  callbacks.add(cb)
  return () => callbacks.delete(cb)
}

export function emitRepoWrite(): void {
  for (const cb of callbacks) cb()
}

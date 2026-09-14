// Záložka Klienti — rozcestník mezi seznamem, detailem a šablonami.
// Obě obrazovky mají vlastní soubor.

import { useEffect, useState } from 'react'
import type { Task } from '../db/types'
import { ClientDetail } from './ClientDetail'
import { ClientList } from './ClientList'
import { TemplatesView } from './TemplatesView'

export function ClientsView({
  onOpenTask,
  focusClientId,
  onFocusConsumed,
}: {
  onOpenTask: (t: Task) => void
  focusClientId?: string | null
  onFocusConsumed?: () => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(focusClientId ?? null)
  const [showTemplates, setShowTemplates] = useState(false)

  useEffect(() => {
    if (focusClientId) {
      setSelectedId(focusClientId)
      setShowTemplates(false)
      onFocusConsumed?.()
    }
  }, [focusClientId, onFocusConsumed])

  if (selectedId) {
    return <ClientDetail id={selectedId} onBack={() => setSelectedId(null)} onOpenTask={onOpenTask} />
  }
  if (showTemplates) {
    return <TemplatesView onBack={() => setShowTemplates(false)} />
  }
  return <ClientList onSelect={setSelectedId} onTemplates={() => setShowTemplates(true)} />
}

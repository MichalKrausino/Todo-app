// Konverzace u úkolu ve sdíleném projektu (Fáze 8).
//
// Vlastní soubor proto, že s detailem úkolu nesdílí nic než `task`: má
// vlastní stav, vlastní síťování i vlastní chybové hlášky — a detail
// úkolu je i bez toho nejdelší komponenta v appce.

import { useEffect, useState } from 'react'
import type { Task, TodoistComment } from '../db/types'
import { getTask } from '../db/repo'
import { loadTodoistComments, postTodoistComment } from '../sync/todoist'
import { jePlatnyCas } from '../lib/dates'

const commentFmt = new Intl.DateTimeFormat('cs-CZ', {
  day: 'numeric',
  month: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

// Konverzace u úkolu ve sdíleném projektu. Tady se s klientem doopravdy
// domlouvá, takže je to v appce k ničemu, když to musím číst jinde.
// Stahuje se až při otevření úkolu a ukládá se do něj — offline i na
// druhém zařízení je pak vidět, co bylo řečeno.
export function TodoistTalk({ task }: { task: Task }) {
  const [comments, setComments] = useState<TodoistComment[]>(task.todoistComments ?? [])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void loadTodoistComments(task.id).then(async (err) => {
      if (!alive) return
      if (err) setError(err === 'offline' ? null : err)
      const fresh = await getTask(task.id)
      if (alive && fresh) setComments(fresh.todoistComments ?? [])
    })
    return () => {
      alive = false
    }
  }, [task.id])

  const send = async () => {
    const body = text.trim()
    if (!body) return
    setBusy(true)
    setError(null)
    const err = await postTodoistComment(task.id, body)
    if (err) setError(err)
    else {
      setText('')
      const fresh = await getTask(task.id)
      setComments(fresh?.todoistComments ?? [])
    }
    setBusy(false)
  }

  return (
    <div>
      <h3 className="section-label mb-1.5">konverzace v Todoistu</h3>
      {comments.length > 0 && (
        <ul className="mb-1.5 space-y-1.5">
          {comments.map((c) => (
            <li key={c.id} className="rounded-2xl bg-well px-3 py-2">
              <p className="text-[11px] text-ink-faint">
                {c.author || 'někdo'}
                {/* datum komentáře je z Todoistu, tedy cizí vstup —
                    Intl na neplatném datu vyhodí výjimku a shodil by detail */}
                {jePlatnyCas(c.at) && ` · ${commentFmt.format(new Date(c.at))}`}
              </p>
              <p className="whitespace-pre-wrap text-[14px] text-ink">{c.text}</p>
              {c.attachment && (
                <p className="mt-0.5 text-[12px] text-ink-faint">📎 {c.attachment} (v Todoistu)</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {comments.length === 0 && (
        <p className="mb-1.5 px-1 text-[13px] text-ink-faint">Zatím nic. Napiš první.</p>
      )}
      <div className="flex items-center gap-2 rounded-full bg-well pl-4 pr-1">
        <input
          className="min-w-0 flex-1 bg-transparent py-2.5 text-[16px] text-ink outline-none placeholder:text-ink-faint"
          aria-label="Odpověď na komentář"
          placeholder="Odpovědět…"
          value={text}
          enterKeyHint="send"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void send()
            }
          }}
        />
        <button
          type="button"
          aria-label="Odeslat komentář"
          disabled={busy || !text.trim()}
          onClick={() => void send()}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-card transition-transform duration-150 active:scale-90 disabled:opacity-30"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>
      {error && <p className="mt-1 text-[12px] text-danger">{error}</p>}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Priority, Project, Subtask, Task, TodoistComment } from '../db/types'
import {
  MAX_PINNED,
  activeClients,
  clientProjects,
  getTask,
  removeTask,
  togglePinned,
  updateTask,
} from '../db/repo'
import { Sheet } from './Sheet'
import { deleteBlockForTask } from '../sync/calendar'
import {
  addTodoistSubtask,
  deleteTodoistTask,
  loadTodoistComments,
  postTodoistComment,
  pushTodoistEdits,
  sendTaskToTodoist,
  setTodoistSubtaskDone,
} from '../sync/todoist'
import { SUB_PREFIX } from '../lib/todoistMap'
import { addDays, fromISODate, jePlatnyCas, toISODate, todayISO } from '../lib/dates'
import { PRIORITY_LABELS } from '../lib/labels'
import {
  PRESET_LABELS,
  humanizeRule,
  presetFromRule,
  ruleFromPreset,
  type RecurrencePreset,
} from '../lib/rrule'

const field = 'w-full rounded-lg border border-line bg-card px-3 py-2 text-[16px] outline-none focus:border-accent/60 disabled:bg-well disabled:text-ink-soft'
const label = 'mb-1 block text-xs font-medium text-ink-soft'
// py-1.5: pod třicet pixelů se pilulka na telefonu trefuje mizerně
const dayChip = 'rounded-full px-3 py-2 text-[11px] font-medium transition-transform duration-150 active:scale-95'

// Rychlé volby pod polem s datem. Dva důvody: nejčastější posun je stejně
// „dnes / zítra", a hlavně — nativní <input type="date"> na iPhonu nemá
// jak vyprázdnit, takže bez křížku šel termín přidat, ale ne odebrat.
function DenChipy({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const dnes = todayISO()
  const zitra = toISODate(addDays(fromISODate(dnes), 1))
  return (
    <div className="mt-1 flex items-center gap-1">
      {([['Dnes', dnes], ['Zítra', zitra]] as const).map(([popisek, iso]) => (
        <button
          key={popisek}
          type="button"
          onClick={() => onChange(iso)}
          aria-pressed={value === iso}
          className={`${dayChip} ${value === iso ? 'bg-ink text-paper' : 'bg-accent-wash text-accent-deep'}`}
        >
          {popisek}
        </button>
      ))}
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Vymazat datum"
          className={`${dayChip} bg-well text-ink-soft`}
        >
          ✕
        </button>
      )}
    </div>
  )
}

export function TaskEditSheet({ task, onClose }: { task: Task; onClose: () => void }) {
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes ?? '')
  const [clientId, setClientId] = useState(task.clientId ?? '')
  const [projectId, setProjectId] = useState(task.projectId ?? '')
  const [priority, setPriority] = useState<Priority>(task.priority)
  // Importovaný úkol se dá upravovat a změny letí zpátky do Todoistu.
  // Zamčené zůstává jen zařazení — přesouvat úkol mezi projekty klienta
  // patří do Todoistu, ne sem.
  const fromTodoist = Boolean(task.todoistId)
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | string>('idle')
  const [dueDate, setDueDate] = useState(task.dueDate ?? '')
  const [dueTime, setDueTime] = useState(task.dueTime ?? '')
  const [scheduledFor, setScheduledFor] = useState(task.scheduledFor ?? '')
  // 'none' | předvolba | 'custom' (existující pravidlo mimo předvolby zachovat)
  const initialRecurrence = task.recurrenceRule ? presetFromRule(task.recurrenceRule) : 'none'
  const [recurrence, setRecurrence] = useState<string>(initialRecurrence)
  // Checklist se ukládá hned při každé změně (jako iOS Připomínky) —
  // odškrtnutí podúkolu nesmí čekat na „Uložit". Save ho neposílá,
  // Dexie update mění jen zaslaná pole.
  const [subtasks, setSubtasks] = useState<Subtask[]>(task.subtasks ?? [])
  const [newSub, setNewSub] = useState('')
  // Špendlík „Top 3 dne" se ukládá hned (jako checklist) — je to
  // rozhodnutí o dnešku, ne editace, kterou by šlo zahodit přes Zrušit.
  const [pinnedFor, setPinnedFor] = useState(task.pinnedFor)
  const [pinFull, setPinFull] = useState(false)

  const pinToday = async () => {
    const day = todayISO()
    const okPin = await togglePinned(task.id, day)
    if (!okPin) {
      setPinFull(true)
      setTimeout(() => setPinFull(false), 2600)
      return
    }
    setPinnedFor(pinnedFor === day ? undefined : day)
  }

  const persistSubtasks = (list: Subtask[]) => {
    setSubtasks(list)
    void updateTask(task.id, { subtasks: list })
  }

  // U todoistího úkolu vznikne krok i tam, ať checklist sedí na obou
  // stranách. Když se to nepovede (offline), zůstane krok lokální —
  // stažení ho nesmaže, jen se nepropíše ven.
  const addSubtask = async () => {
    const title = newSub.trim()
    if (!title) return
    setNewSub('')
    const local = { id: crypto.randomUUID(), title, done: false }
    persistSubtasks([...subtasks, local])
    if (!task.todoistId) return
    const remoteId = await addTodoistSubtask(task.todoistId, title)
    if (!remoteId) return
    persistSubtasks(
      [...subtasks, local].map((s) => (s.id === local.id ? { ...s, id: `${SUB_PREFIX}${remoteId}` } : s)),
    )
  }

  const clients = useLiveQuery(activeClients, []) ?? []
  // Klient s napojeným projektem — jen u něj má smysl nabízet odeslání.
  const todoistClient = clients.find(
    (c) => c.id === clientId && (c.todoistProjectIds?.length ?? 0) > 0,
  )
  const projects =
    useLiveQuery(
      () => (clientId ? clientProjects(clientId) : Promise.resolve<Project[]>([])),
      [clientId],
    ) ?? []

  const save = async (close: () => void) => {
    if (!title.trim()) return
    const hasDate = Boolean(dueDate || scheduledFor)
    let recurrenceRule: string | undefined
    if (recurrence === 'custom') recurrenceRule = task.recurrenceRule
    else if (recurrence !== 'none') {
      recurrenceRule = ruleFromPreset(recurrence as RecurrencePreset, dueDate || scheduledFor || todayISO())
    }
    await updateTask(task.id, {
      title: title.trim(),
      notes: notes.trim() || undefined,
      clientId: clientId || undefined,
      projectId: projectId || undefined,
      priority,
      dueDate: dueDate || undefined,
      // čas bez data nedává smysl — deadline s časem se váže na den
      dueTime: dueDate && dueTime ? dueTime : undefined,
      scheduledFor: scheduledFor || undefined,
      recurrenceRule,
      status: task.status === 'inbox' && hasDate ? 'active' : task.status,
    })
    // Úprava todoistího úkolu se označí jako neodeslaná a hned se zkusí
    // poslat; do té doby ji stažení nepřepíše.
    if (fromTodoist) {
      await updateTask(task.id, { todoistDirty: true })
      void pushTodoistEdits()
    }
    // Zrušené naplánování uvolní i blok v kalendáři „Todo".
    if (task.calendarEventId && !scheduledFor) void deleteBlockForTask(task)
    close()
  }

  const del = async (close: () => void) => {
    if (!confirm('Smazat úkol?')) return
    // U todoistího úkolu se ptáme zvlášť: smazat ho tam znamená smazat ho
    // i klientovi ve sdíleném projektu. Bez doptání zmizí jen z appky.
    if (task.todoistId && confirm('Smazat ho i v Todoistu? Jinak zmizí jen odsud, klientovi zůstane.')) {
      await deleteTodoistTask(task.id)
    }
    if (task.calendarEventId) void deleteBlockForTask(task)
    await removeTask(task.id)
    close()
  }

  return (
    <Sheet onClose={onClose} className="space-y-3">
      {(close) => (
        <>
        <header className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold">Upravit úkol</h2>
          <button
            type="button"
            aria-label={pinnedFor === todayISO() ? 'Odepnout z Top 3 dne' : 'Připnout mezi Top 3 dne'}
            onClick={() => void pinToday()}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-[background-color,color,transform] duration-150 active:scale-95 ${
              pinnedFor === todayISO() ? 'bg-accent text-card' : 'bg-well text-ink-soft'
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 3.5h6l-.8 5.2 3.3 3.1H6.5l3.3-3.1z" />
              <path d="M12 11.8V20.5" />
            </svg>
            {pinnedFor === todayISO() ? 'Top 3 dne' : 'Připnout'}
          </button>
        </header>
        {pinFull && (
          <p className="pop rounded-lg bg-note px-3 py-2 text-[13px] text-note-ink">
            Top {MAX_PINNED} je plná — nejdřív něco odepni. Míň priorit, víc hotovo.
          </p>
        )}
        {fromTodoist && (
          <p className="rounded-lg bg-well px-3 py-2 text-[13px] leading-relaxed text-ink-soft">
            Úkol je z Todoistu — název, termín a priorita se odsud píšou i tam.
            {task.todoistRecurring && ' Opakuje se; odškrtnutím se posune na další termín.'}
            {task.todoistDirty && ' Poslední změna ještě čeká na odeslání.'}
          </p>
        )}
        <div>
          <label className={label}>Úkol</label>
          <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} />
          {/* Štítky z Todoistu jsou informace, ne pole k vyplnění —
              appka s nimi nic nedělá, ale schovávat je by bylo divné. */}
          {task.todoistLabels?.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {task.todoistLabels.map((l) => (
                <span key={l} className="rounded-full bg-well px-2 py-0.5 text-[11px] text-ink-soft">
                  @{l}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Klient</label>
            <select
              className={field}
              value={clientId}
              disabled={fromTodoist}
              onChange={(e) => {
                setClientId(e.target.value)
                setProjectId('')
              }}
            >
              <option value="">Bez klienta</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Projekt</label>
            <select
              className={field}
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              disabled={fromTodoist || !clientId}
            >
              <option value="">{clientId ? 'Bez projektu' : 'Nejdřív vyber klienta'}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Termín</label>
            <input
              type="date"
              className={field}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
            <DenChipy value={dueDate} onChange={setDueDate} />
          </div>
          <div>
            <label className={label}>Naplánováno</label>
            <input
              type="date"
              className={field}
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
            />
            <DenChipy value={scheduledFor} onChange={setScheduledFor} />
          </div>
          <div>
            {/* Popisek nad polem jako u všech ostatních. Dřív stál vedle
                něj a pole bylo užší než datum nad ním, takže sloupec
                vypadal rozsypaně. Čas patří k termínu, proto je v jeho
                sloupci hned pod ním. */}
            <label className={label} htmlFor="cas-terminu">
              Čas termínu
            </label>
            <input
              id="cas-terminu"
              type="time"
              className={field}
              value={dueTime}
              onChange={(e) => {
                setDueTime(e.target.value)
                // čas na prázdném datu doplní dnešek, ať se neztratí
                if (e.target.value && !dueDate) setDueDate(todayISO())
              }}
            />
          </div>
        </div>
        {/* Dvě data vedle sebe jsou nejčastější zádrhel celé appky —
            bez věty pod nimi si nikdo nedomyslí, čím se liší. */}
        <p className="-mt-1 text-[12px] leading-relaxed text-ink-faint">
          <strong className="font-medium text-ink-soft">Termín</strong> je dokdy to musí být
          hotové. <strong className="font-medium text-ink-soft">Naplánováno</strong> je den, kdy
          se tomu chceš věnovat — ten se ukáže na Dnes.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Priorita</label>
            <select
              className={field}
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
            >
              {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Opakování</label>
            <select className={field} value={recurrence} onChange={(e) => setRecurrence(e.target.value)}>
              <option value="none">Neopakuje se</option>
              {(Object.keys(PRESET_LABELS) as RecurrencePreset[]).map((p) => (
                <option key={p} value={p}>
                  {PRESET_LABELS[p]}
                </option>
              ))}
              {initialRecurrence === 'custom' && task.recurrenceRule && (
                <option value="custom">Vlastní ({humanizeRule(task.recurrenceRule)})</option>
              )}
            </select>
          </div>
        </div>

        <div>
          <label className={label}>
            Podúkoly
            {subtasks.length > 0 && ` · ${subtasks.filter((s) => s.done).length}/${subtasks.length}`}
          </label>
          {subtasks.length > 0 && (
            <ul className="mb-1.5 divide-y divide-line overflow-hidden rounded-lg border border-line">
              {subtasks.map((s) => (
                <li key={s.id} className="flex items-center gap-2.5 bg-card px-3 py-2">
                  <button
                    type="button"
                    aria-label={s.done ? `Vrátit podúkol ${s.title}` : `Dokončit podúkol ${s.title}`}
                    onClick={() => {
                      persistSubtasks(
                        subtasks.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)),
                      )
                      // krok z Todoistu se odškrtne i tam
                      void setTodoistSubtaskDone(s.id, !s.done)
                    }}
                    className="-m-1.5 shrink-0 p-1.5 transition-transform duration-150 active:scale-90"
                  >
                    <span
                      key={String(s.done)}
                      className={`pop flex h-[18px] w-[18px] items-center justify-center rounded-full border-[1.5px] transition-colors duration-200 ${
                        s.done ? 'border-accent bg-accent text-card' : 'border-ink-faint text-transparent'
                      }`}
                    >
                      <svg viewBox="0 0 20 20" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4.5 10.5l3.8 3.8 7.2-8.6" />
                      </svg>
                    </span>
                  </button>
                  <span
                    className={`min-w-0 flex-1 truncate text-[14px] ${
                      s.done ? 'text-ink-faint line-through' : 'text-ink'
                    }`}
                  >
                    {s.title}
                  </span>
                  {/* Krok z Todoistu odsud mazat nejde — smazal by se
                      klientovi v jeho projektu a stejně by se vrátil.
                      Odškrtnout jde, to je v pořádku. */}
                  {s.id.startsWith(SUB_PREFIX) ? (
                    <span className="shrink-0 text-[11px] text-ink-faint" title="Krok z Todoistu">
                      Todoist
                    </span>
                  ) : (
                  <button
                    type="button"
                    aria-label={`Smazat podúkol ${s.title}`}
                    onClick={() => persistSubtasks(subtasks.filter((x) => x.id !== s.id))}
                    className="-m-2 shrink-0 p-2 text-ink-faint transition-transform duration-150 active:scale-90"
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-1.5">
            <input
              className={`${field} min-w-0 flex-1`}
              placeholder="Přidat podúkol…"
              value={newSub}
              enterKeyHint="done"
              onChange={(e) => setNewSub(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addSubtask()
                }
              }}
            />
            <button
              type="button"
              aria-label="Přidat podúkol"
              disabled={!newSub.trim()}
              onClick={addSubtask}
              className="flex w-10 shrink-0 items-center justify-center rounded-lg bg-well text-ink-soft transition-transform duration-150 active:scale-90 disabled:opacity-30"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
        </div>

        <div>
          <label className={label}>Poznámky</label>
          <textarea className={field} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {fromTodoist && (
          <a
            href={`https://app.todoist.com/app/task/${task.todoistId}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-[13px] font-medium text-accent"
          >
            Otevřít v Todoistu
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 5h5v5M19 5l-8 8M18 13.5V19H5V6h5.5" />
            </svg>
          </a>
        )}

        {fromTodoist && <TodoistTalk task={task} />}

        {/* Lokální úkol u klienta s napojeným Todoistem — jedním ťuknutím
            ho uvidí i klient. Nikdy se to nestane samo bez zapnutí. */}
        {!fromTodoist && todoistClient && (
          <button
            type="button"
            disabled={sendState === 'sending' || sendState === 'sent'}
            onClick={async () => {
              setSendState('sending')
              await updateTask(task.id, {
                title: title.trim(),
                notes: notes.trim() || undefined,
                priority,
                dueDate: dueDate || undefined,
                dueTime: dueDate && dueTime ? dueTime : undefined,
              })
              const err = await sendTaskToTodoist(task.id)
              setSendState(err ?? 'sent')
            }}
            className="w-full rounded-lg border border-line px-3 py-2.5 text-left text-sm font-medium text-accent transition-transform duration-150 active:scale-[0.99] disabled:opacity-50"
          >
            {sendState === 'sending'
              ? 'Posílám…'
              : sendState === 'sent'
                ? `Odesláno do Todoistu — ${todoistClient.name} to teď vidí`
                : sendState === 'idle'
                  ? `Poslat do Todoistu (${todoistClient.name})`
                  : sendState}
          </button>
        )}

        <div className="flex items-center justify-between pt-1">
          <button
            className="px-2 py-2 text-sm font-medium text-danger transition-transform duration-150 active:scale-95"
            onClick={() => void del(close)}
          >
            Smazat
          </button>
          <div className="flex gap-2">
            <button
              className="rounded-lg px-4 py-2 text-sm font-medium text-ink-soft transition-transform duration-150 active:scale-95"
              onClick={close}
            >
              Zrušit
            </button>
            <button
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-card transition-transform duration-150 active:scale-95 disabled:opacity-30"
              disabled={!title.trim()}
              onClick={() => void save(close)}
            >
              Uložit
            </button>
          </div>
        </div>
        </>
      )}
    </Sheet>
  )
}

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
function TodoistTalk({ task }: { task: Task }) {
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
      <label className={label}>Konverzace v Todoistu</label>
      {comments.length > 0 && (
        <ul className="mb-1.5 space-y-1.5">
          {comments.map((c) => (
            <li key={c.id} className="rounded-lg bg-well px-3 py-2">
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
        <p className="mb-1.5 text-[13px] text-ink-faint">Zatím nic. Napiš první.</p>
      )}
      <div className="flex gap-1.5">
        <input
          className={`${field} min-w-0 flex-1`}
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
          className="flex w-10 shrink-0 items-center justify-center rounded-lg bg-well text-ink-soft transition-transform duration-150 active:scale-90 disabled:opacity-30"
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

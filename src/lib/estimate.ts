// Tichý odhad času úkolu (první krok Fáze 5 — zatím heuristika bez modelu).
// Odhad se NIKDY nezobrazuje jako pole k vyplnění (viz CLAUDE.md) — používá
// ho jen kalendář jako délku bloku (scheduleBlockForTask, jinak 60 min)
// a v budoucnu ranní plánování. Model přes předplatné ho později zpřesní.

// Vzory od nejdelších činností k nejkratším — první shoda vyhrává.
// Bez diakritiky a lowercase (viz fold níže), \b nefunguje pro češtinu
// spolehlivě, proto prefixové kmeny slov.
const PATTERNS: Array<[RegExp, number]> = [
  [/audit|analyz|strategi|koncepc|vyzkum|research/, 120],
  [/napsat zpravu|odpovedet/, 30], // výjimky před obecným „napsat"
  [/report|prezentac|navrh|napsat|pripravit|vytvorit|nachystat|clanek|sepsat|wireframe|rozpocet/, 90],
  [/schuzk|meeting|porada|workshop|onboarding/, 60],
  [/faktur|vyuctovani/, 45],
  [/zavolat|brnknout|obvolat|call/, 30],
  [/kontrol|projit|mrknout|overit|prohlednout|status/, 30],
  [/email|e-mail|poslat|odeslat|objednat/, 30],
]

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

// Vrací minuty, nebo undefined když si heuristika není jistá
// (kalendář si pak vezme výchozích 60).
export function estimateTaskMinutes(title: string): number | undefined {
  const t = fold(title)
  for (const [re, minutes] of PATTERNS) {
    if (re.test(t)) return minutes
  }
  return undefined
}

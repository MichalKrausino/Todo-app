// Dvojité ťuknutí na záložku doku.
//
// Čistá logika schválně: stejné pravidlo musí platit pro prst (pointerup
// v doku) i pro klávesnici (dvakrát „1" na Macu), a bez testu by se ty dvě
// cesty rozešly. Okno 320 ms je práh dvojitého ťuknutí v iOS — kratší se
// netrefí, delší začne spojovat dvě samostatná ťuknutí.
//
// Počítá se DVOJÍ ŤUKNUTÍ NA TUTÉŽ ZÁLOŽKU, ať už byla vybraná, nebo ne.
// Dřív se gesto počítalo jen na už vybrané záložce — z Plánu se tedy
// muselo ťuknout na Dnes, počkat, a teprve pak ťuknout dvakrát. To po
// člověku chce, aby věděl, kde zrovna stojí, přitom ruka umí jedinou věc:
// „chci všechny úkoly" = dvakrát klepnout na tu ikonu. První ťuknutí
// přepne, druhé rozbalí, a mezi nimi není nic k zapamatování.
//
// Přepnutí na JINOU záložku počítadlo nuluje samo (`prev.id !== id`),
// takže rychlé Dnes → Plán → Dnes žádné gesto nespustí.

export const DVOJKLIK_MS = 320

export interface Stisk {
  id: string
  kdy: number
}

export function vyhodnotStisk(
  prev: Stisk | null,
  id: string,
  kdy: number,
  okno: number = DVOJKLIK_MS,
): { stav: Stisk | null; dvojite: boolean } {
  const dvojite = prev !== null && prev.id === id && kdy >= prev.kdy && kdy - prev.kdy <= okno
  // Po dvojitém se počítadlo nuluje — trojité ťuknutí není dvojité dvakrát.
  return { stav: dvojite ? null : { id, kdy }, dvojite }
}

// Dvojité ťuknutí na už vybranou záložku doku.
//
// Čistá logika schválně: stejné pravidlo musí platit pro prst (pointerup
// v doku) i pro klávesnici (dvakrát „1" na Macu), a bez testu by se ty dvě
// cesty rozešly. Okno 320 ms je práh dvojitého ťuknutí v iOS — kratší se
// netrefí, delší začne spojovat dvě samostatná ťuknutí.
//
// Dvojité se počítá JEN na záložce, která už byla vybraná. Kdyby stačila
// dvě ťuknutí po sobě, rychlé přepnutí Klienti → Dnes → Dnes by omylem
// otevřelo něco, co člověk nechtěl.

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

// Kdy je appka na Macu, a ne v ruce.
//
// PROČ PRÁH A NE „JE TO DOTYK"
//
// Rozhoduje ŠÍŘKA OKNA, ne druh zařízení. iPad na šířku i MacBook
// s appkou v poloviční obrazovce jsou tentýž případ: je místo na dva
// sloupce, nebo není. Kdyby se ptalo na `pointer: fine`, appka by na
// dotykovém iPadu zůstala navždy telefonem a na Macu zmenšeném do
// čtvrtiny obrazovky by se rozsypala.
//
// 1024 px je nejmenší šířka, kde vedle sebe vyjde boční panel (240),
// seznam (min. 380) a detail (min. 380) i s mezerami. Pod ní se
// kterýkoli ze tří sloupců zmáčkne pod čitelnou míru, a to je horší než
// poctivý telefon.
//
// POZOR: appka se na Macu spouští přes Safari → Přidat do Docku, takže
// okno může mít libovolnou šířku a člověk s ním hýbe. Přepnutí proto
// musí být živé (`useSiroko` poslouchá `resize`), ne jen při startu.

import { useEffect, useState } from 'react'

export const SIROKY_PRAH = 1024

/** Vejdou se vedle sebe tři sloupce? */
export const jeSiroko = (sirka: number): boolean => sirka >= SIROKY_PRAH

/**
 * Je okno široké? Překreslí se při změně velikosti — appka v okně na
 * Macu se roztahuje pořád, tohle není vlastnost, která se čte jednou.
 */
export function useSiroko(): boolean {
  const [siroko, setSiroko] = useState(() =>
    typeof window === 'undefined' ? false : jeSiroko(window.innerWidth),
  )
  useEffect(() => {
    const zmer = () => setSiroko(jeSiroko(window.innerWidth))
    zmer()
    window.addEventListener('resize', zmer)
    return () => window.removeEventListener('resize', zmer)
  }, [])
  return siroko
}

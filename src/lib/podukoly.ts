// Termíny u podúkolů — čisté funkce nad checklistem.
//
// Podúkol je krok uvnitř úkolu, ne samostatný úkol: nemá klienta, projekt
// ani prioritu a do Plánu se nedostane. Termín ale mít smí — velký úkol
// („spustit kampaň") má kroky, které mají svoje datum („podklady do
// středy"), a dokud se ten den dal zapsat leda do názvu kroku, nevěděla
// o něm appka nic.
//
// KDE TO MUSÍ BÝT VIDĚT
//
// Termín, který je vidět jedině po otevření úkolu, appka neuhlídá — a to
// je přesně ten druh slibu, který tahle appka nedává (rozhraní slibuje,
// logika mlčí). Proto z těchhle funkcí čte i řádek úkolu: jakmile má
// nehotový krok termín, nese ho i řádek v seznamu, a propadlý je červený
// stejně jako propadlý termín úkolu.
//
// Do Plánu se kroky NEPŘIDÁVAJÍ. Den v Plánu odpovídá na „co dnes dělám"
// a kroky jsou uvnitř práce, ne práce samy; kdyby se sypaly do dnů,
// počítal by se jeden úkol vícekrát a strop dne (v úkolech!) by přestal
// znamenat to, co měří. Kdo potřebuje krok v Plánu, potřebuje úkol.

import type { Subtask } from '../db/types'

/** Nehotové kroky s termínem, seřazené od nejbližšího. */
export function krokySTerminem(kroky: Subtask[] | undefined): Subtask[] {
  return (kroky ?? [])
    .filter((s) => !s.done && s.dueDate)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
}

/** Nejbližší termín nehotového kroku, nebo `undefined`. */
export function dalsiTerminKroku(kroky: Subtask[] | undefined): string | undefined {
  return krokySTerminem(kroky)[0]?.dueDate
}

/**
 * Propadlý krok: má termín před dneškem a není hotový. Dnešek propadlý
 * není — den ještě běží, stejně jako u termínu úkolu (`TaskRow` barví
 * červeně až včerejšek, dnešek jen s časem, a ten krok nemá).
 */
export const jeKrokPropadly = (krok: Subtask, dnes: string): boolean =>
  !krok.done && !!krok.dueDate && krok.dueDate < dnes

/** Propadl aspoň jeden krok? Z toho se barví značka na řádku úkolu. */
export const maPropadlyKrok = (kroky: Subtask[] | undefined, dnes: string): boolean =>
  (kroky ?? []).some((s) => jeKrokPropadly(s, dnes))

/**
 * Kroky pro nový výskyt opakovaného úkolu: odškrtnutí se nuluje a
 * **termíny se zahazují**. Termín kroku platil pro ten jeden výskyt —
 * „podklady do 5." u zářijového reportu neplatí pro říjnový a posunout
 * ho appka neumí (o kolik? o měsíc? o tolik, o kolik se posunul úkol?).
 * Ponechaný termín by z každého nového výskytu udělal hromadu propadlých
 * kroků hned při založení, tedy červenou, kterou nikdo nezpůsobil.
 */
export const krokyProDalsiVyskyt = (kroky: Subtask[] | undefined): Subtask[] | undefined =>
  kroky?.map(({ dueDate: _zahozeno, ...s }) => ({ ...s, done: false }))

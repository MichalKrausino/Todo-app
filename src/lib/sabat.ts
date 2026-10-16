// Šabat (od pátečního do sobotního západu slunce) — appka dováží TENTÝŽ
// soubor, podle kterého mlčí edge funkce `reminders`, takže co appka ukáže
// („od 16:12 šabat"), podle toho se řídí i notifikace ze serveru.
export * from '../../supabase/functions/reminders/sabat'

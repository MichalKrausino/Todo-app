// Slučování tříd jako v shadcn/ui: clsx pro podmínky, tailwind-merge
// pro konflikty (poslední `px-*` vyhraje místo dvou vedle sebe).
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...vstup: ClassValue[]) => twMerge(clsx(vstup))

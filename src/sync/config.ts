// Bez těchto proměnných (.env.local) appka běží čistě lokálně — sync se nezapne.

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

// Veřejný VAPID klíč pro Web Push (párový privátní drží server v Supabase).
export const VAPID_PUBLIC_KEY =
  'BAUYRKt06XwObwIPPP_siHBVR3yXXv1pRvq1ikz0oX_A-GXiYGvc1aM7G7tb_pHCDY7dehMJxAFzgb8cj0bRbE0'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages servíruje z podcesty (https://<user>.github.io/Todo-app/) —
// workflow nastavuje BASE_PATH=/Todo-app/. Lokální vývoj běží na kořeni.
const base = process.env.BASE_PATH ?? '/'

// Otisk buildu do nastavení. Bez něj se nedá poznat, jestli má telefon
// poslední verzi, nebo mu servisní worker drží starou z cache.
const build = [
  new Date().toISOString().slice(0, 16).replace('T', ' '),
  (process.env.GITHUB_SHA ?? '').slice(0, 7),
]
  .filter(Boolean)
  .join(' · ')

// Knihovny do vlastních balíčků podle toho, jak často se mění.
//
// Dřív šlo všechno do jediného souboru (1,1 MB). Appka se nasazuje skoro
// každý den a název souboru nese otisk obsahu, takže JEDNO písmeno ve
// vlastním kódu změnilo otisk celku a servisní worker stáhl do telefonu
// znovu celý megabajt — včetně Reactu, Dexie i motion, které se nezměnily.
// Rozdělené balíčky mají vlastní otisky: mění se jen ten s kódem appky,
// zbytek zůstane v cache. Na první návštěvě se nestahuje víc dat, jen se
// stáhnou souběžně.
const knihovny: Array<[string, string[]]> = [
  ['react', ['react/', 'react-dom/', 'scheduler/', 'react/jsx-runtime']],
  ['supabase', ['@supabase/']],
  ['dexie', ['dexie/', 'dexie-react-hooks/']],
  ['motion', ['motion/', 'motion-dom/', 'motion-utils/', 'framer-motion/']],
  ['rrule', ['rrule/', 'tslib/']],
  ['prvky', ['radix-ui/', '@radix-ui/', 'cmdk/', '@floating-ui/', 'react-remove-scroll', 'aria-hidden/', 'use-callback-ref/', 'use-sidecar/', 'get-nonce/']],
]

export default defineConfig({
  base,
  define: { __BUILD__: JSON.stringify(build) },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return
          const cesta = id.split('node_modules/').pop() ?? ''
          for (const [jmeno, vzory] of knihovny) {
            if (vzory.some((v) => cesta.startsWith(v))) return jmeno
          }
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Vlastní SW (src/sw.ts): precache + push notifikace ranního návrhu.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Todo',
        short_name: 'Todo',
        description: 'Chytrý todo + kalendář',
        lang: 'cs',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#f2f2f7',
        theme_color: '#f2f2f7',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})

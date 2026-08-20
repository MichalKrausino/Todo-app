// Vlastní service worker (strategie injectManifest): precache appky
// jako dřív + příjem push notifikací ranního návrhu (Fáze 6).

/// <reference lib="webworker" />
declare let self: ServiceWorkerGlobalScope

import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

self.skipWaiting()
clientsClaim()

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))

self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload: { title?: string; body?: string; url?: string; tag?: string; badge?: number } = {}
  try {
    payload = event.data.json()
  } catch {
    payload = { body: event.data.text() }
  }
  event.waitUntil(
    (async () => {
      // Odznak na ikoně (iOS 16.4+): server posílá počet úkolů na dnes
      // a po termínu — drží se čerstvý i bez otevření appky.
      if (typeof payload.badge === 'number' && 'setAppBadge' in self.navigator) {
        await (payload.badge > 0
          ? self.navigator.setAppBadge(payload.badge).catch(() => {})
          : self.navigator.clearAppBadge().catch(() => {}))
      }

      // Když se uživatel na appku právě dívá, notifikace by jen překážela
      // — obsah vidí na obrazovce. Odznak se přesto srovná (výše).
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const watching = windows.some((c) => c.visibilityState === 'visible' && c.focused)
      if (watching) return

      await self.registration.showNotification(payload.title ?? 'Todo', {
        body: payload.body,
        icon: 'icon-192.png',
        badge: 'icon-192.png',
        data: { url: payload.url },
        tag: payload.tag ?? 'todo', // stejný druh notifikace se nahrazuje, nekupí
      })
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? self.registration.scope
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      const existing = clients.find((c) => c.url.startsWith(self.registration.scope))
      if (existing) {
        await existing.focus()
        // otevřenému oknu předat cíl (např. #review) — main.tsx poslouchá
        existing.postMessage({ type: 'navigate', url })
        return
      }
      return self.clients.openWindow(url)
    }),
  )
})

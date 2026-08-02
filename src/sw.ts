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
  let payload: { title?: string; body?: string; url?: string } = {}
  try {
    payload = event.data.json()
  } catch {
    payload = { body: event.data.text() }
  }
  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'Todo', {
      body: payload.body,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: { url: payload.url },
      tag: 'morning-plan', // nová ranní notifikace nahradí starou
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? self.registration.scope
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.startsWith(self.registration.scope))
      if (existing) return existing.focus()
      return self.clients.openWindow(url)
    }),
  )
})

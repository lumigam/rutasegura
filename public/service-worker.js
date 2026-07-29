const CACHE = 'rutasegura-shell-v1'
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET' || new URL(request.url).pathname.startsWith('/api/')) return
  event.respondWith(fetch(request).then(response => {
    if (response.ok) {
      const copy = response.clone()
      caches.open(CACHE).then(cache => cache.put(request, copy))
    }
    return response
  }).catch(() => caches.match(request).then(response => response || caches.match('/'))))
})

self.addEventListener('push', event => {
  let data = { title: '📍 Aviso de ruta', body: 'Toca este aviso para ver el detalle.', url: '/', tag: 'rutasegura-aviso' }
  try { if (event.data) data = { ...data, ...event.data.json() } } catch { /* Se usa el mensaje genérico. */ }
  const notification = self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/favicon-32.png',
    image: '/icons/icon-512.png',
    tag: data.tag,
    renotify: true,
    requireInteraction: true,
    silent: false,
    vibrate: [700, 250, 700, 250, 1200],
    timestamp: Date.now(),
    actions: [{ action: 'open', title: 'VER RUTA' }],
    data: { url: data.url || '/' },
  })
  const badge = 'setAppBadge' in navigator ? navigator.setAppBadge(1).catch(() => undefined) : Promise.resolve()
  event.waitUntil(Promise.all([notification, badge]))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href
  const badge = 'clearAppBadge' in navigator ? navigator.clearAppBadge().catch(() => undefined) : Promise.resolve()
  const opening = clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const existing = windows.find(client => client.url.startsWith(self.location.origin))
    return existing ? existing.focus().then(client => client.navigate(target)) : clients.openWindow(target)
  })
  event.waitUntil(Promise.all([badge, opening]))
})

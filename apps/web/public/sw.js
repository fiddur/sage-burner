/*
 * The service worker, and only what push needs.
 *
 * Plain JavaScript in `public/` rather than a bundled entry: it is copied verbatim
 * to the site root, which is where a worker has to live to claim `/` as its scope.
 * That also means it is outside the type-check and the test suite, so it is kept
 * small enough that there is nothing in it worth testing — no fetch handler, no
 * caching, no state. Adding either would put the app's offline behaviour in a file
 * nothing verifies.
 *
 * `@fastify/static` serves everything outside `assets/` as `no-cache`, which is
 * what lets a redeploy replace this rather than leaving browsers on an old copy.
 */

self.addEventListener('push', (event) => {
  // A payload that will not parse is still worth a notification: something
  // happened, and silence is the worse failure. The push service cannot read it —
  // it is encrypted to this browser's key — so a malformed one means our bug.
  let body = 'Something needs your attention.'
  try {
    const data = event.data ? event.data.json() : undefined
    if (data && typeof data.body === 'string') body = data.body
  } catch {
    // Keep the fallback.
  }

  event.waitUntil(
    self.registration.showNotification('Sage Burner', {
      body,
      // Collapses repeats: three applications while the phone is locked should be
      // one line to act on, not three identical ones to dismiss.
      tag: 'sage-burner-applications',
      data: { path: '/admin/applications' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const path = (event.notification.data && event.notification.data.path) || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // Focus a tab that is already open rather than piling up new ones, which is
      // what happens on a phone otherwise.
      for (const client of windows) {
        if (client.url.endsWith(path) && 'focus' in client) return client.focus()
      }

      return self.clients.openWindow(path)
    }),
  )
})

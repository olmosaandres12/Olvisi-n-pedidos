// ===================================================
//  OLVISIÓN — sw.js
//  Service Worker para Push Notifications
// ===================================================

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});

self.addEventListener('push', (e) => {
  if (!e.data) return;

  let data = {};
  try { data = e.data.json(); } catch { data = { title: 'OLVISIÓN', body: e.data.text() }; }

  const title   = data.title || 'OLVISIÓN';
  const options = {
    body:    data.body  || 'Tenés una notificación nueva',
    icon:    '/logo.png',
    badge:   '/logo.png',
    vibrate: [200, 100, 200],
    data:    data.data  || {},
    actions: [
      { action: 'ver', title: 'Ver pedido' },
      { action: 'cerrar', title: 'Cerrar' },
    ],
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  if (e.action === 'cerrar') return;

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      if (clientList.length > 0) {
        clientList[0].focus();
      } else {
        clients.openWindow('/app.html');
      }
    })
  );
});

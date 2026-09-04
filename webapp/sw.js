// Enhanced Service Worker with Push Notifications
const CACHE_NAME = 'insighti-v3.6-admin-network';
const ASSETS = [
  '/index.html',
  '/inspector.html',
  '/css/style.css',
  '/js/data.js',
  '/js/api.js',
  '/js/app.js',
  '/js/inspector.js',
  '/js/push-manager.js',
  '/js/ai/base-detector.js',
  '/js/ai/local-detector.js',
  '/js/ai/cloud-detector.js',
  '/js/ai/hybrid-detector.js',
  '/js/equipment.js',
  '/js/inspector-registration.js',
  '/manifest.json'
];

function isAdminRequest(url) {
  const path = url.pathname;
  return (
    path === '/admin' ||
    path === '/admin.html' ||
    path.endsWith('/admin.html') ||
    path.endsWith('/js/admin.js') ||
    path === '/clear-cache.html'
  );
}

function isHtmlRequest(url) {
  const path = url.pathname;
  return path === '/' || path.endsWith('.html');
}

// Install event
self.addEventListener('install', (event) => {
  console.log('🔧 Service Worker installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('📦 Caching assets...');
      return cache.addAll(ASSETS).catch((err) => {
        console.warn('⚠️ Some assets failed to cache:', err);
      });
    }).then(() => {
      console.log('✅ Service Worker installed');
      return self.skipWaiting();
    })
  );
});

// Activate event
self.addEventListener('activate', (event) => {
  console.log('🚀 Service Worker activating...');
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => {
          console.log('🗑️ Deleting old cache:', k);
          return caches.delete(k);
        })
      );
    }).then(async () => {
      // 예전 admin 캐시가 남아 있으면 제거
      const cache = await caches.open(CACHE_NAME);
      const keys = await cache.keys();
      await Promise.all(
        keys
          .filter((req) => isAdminRequest(new URL(req.url)))
          .map((req) => cache.delete(req))
      );
      console.log('✅ Service Worker activated');
      return self.clients.claim();
    })
  );
});

// Fetch event
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // External API requests pass through
  if (url.origin !== self.location.origin) {
    return;
  }

  // 관리자 페이지/스크립트는 항상 네트워크 우선 (캐시로 메뉴가 안 바뀌는 문제 방지)
  if (isAdminRequest(url) || isHtmlRequest(url)) {
    event.respondWith(
      fetch(request)
        .then((response) => response)
        .catch(() => caches.match(request))
    );
    return;
  }

  // Cache-first strategy for other static assets
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        console.log('📦 Serving from cache:', request.url);
        return cached;
      }

      console.log('🌐 Fetching from network:', request.url);
      return fetch(request)
        .then((response) => {
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch((err) => {
          console.error('❌ Fetch failed:', request.url, err);
          throw err;
        });
    })
  );
});

// Push event - 핵심 푸시 알림 처리
self.addEventListener('push', (event) => {
  console.log('📱 Push notification received:', event);

  let notificationData = {
    title: 'InsightI 알림',
    body: '새로운 알림이 있습니다.',
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    tag: 'insighti-notification',
    requireInteraction: true,
    actions: [
      {
        action: 'view',
        title: '확인',
        icon: '/icon-192x192.png'
      },
      {
        action: 'dismiss',
        title: '닫기',
        icon: '/icon-192x192.png'
      }
    ]
  };

  if (event.data) {
    try {
      const pushData = event.data.json();
      notificationData = {
        ...notificationData,
        ...pushData,
        data: pushData.data || {}
      };
    } catch (error) {
      console.error('❌ Error parsing push data:', error);
    }
  }

  console.log('🔔 Showing notification:', notificationData);

  event.waitUntil(
    self.registration.showNotification(notificationData.title, notificationData)
  );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
  console.log('👆 Notification clicked:', event);

  event.notification.close();

  if (event.action === 'dismiss') {
    console.log('❌ Notification dismissed');
    return;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === self.location.origin && 'focus' in client) {
          console.log('🎯 Focusing existing window');
          return client.focus();
        }
      }

      if (clients.openWindow) {
        const urlToOpen = event.notification.data?.url || '/';
        console.log('🆕 Opening new window:', urlToOpen);
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

console.log('📱 Service Worker loaded with push notifications');

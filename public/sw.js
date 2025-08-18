// Service Worker for GrooveBox - Enhanced Background Audio & Sync
const CACHE_NAME = 'groovebox-v1';
const KEEP_ALIVE_INTERVAL = 10000; // 10 seconds (more aggressive)

// Install event - cache essential resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        '/',
        '/index.html',
        '/favicon/favicon.svg'
      ]);
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Background sync for keep-alive
self.addEventListener('sync', (event) => {
  if (event.tag === 'groovebox-keep-alive') {
    event.waitUntil(keepAlive());
  }
});

// Keep connection alive
async function keepAlive() {
  const clients = await self.clients.matchAll();
  
  clients.forEach((client) => {
    if (client.url.includes('groovebox')) {
      // Send keep-alive message to all clients
      client.postMessage({
        type: 'KEEP_ALIVE',
        timestamp: Date.now()
      });
    }
  });
}

// Handle messages from main app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'REGISTER_KEEP_ALIVE') {
    // Register periodic background sync
    if ('periodicSync' in self.registration) {
      self.registration.periodicSync.register('groovebox-keep-alive', {
        minInterval: KEEP_ALIVE_INTERVAL
      });
    }
    
    // Also set up a more aggressive interval
    setInterval(() => {
      keepAlive();
    }, KEEP_ALIVE_INTERVAL);
  }
  
  if (event.data && event.data.type === 'UNREGISTER_KEEP_ALIVE') {
    // Unregister periodic background sync
    if ('periodicSync' in self.registration) {
      self.registration.periodicSync.unregister('groovebox-keep-alive');
    }
  }
});

// Fetch event - serve cached resources when offline
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;
  
  // Skip non-GET requests and external requests
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
    return;
  }
  
  event.respondWith(
    caches.match(event.request).then((response) => {
      // Return cached version or fetch from network
      return response || fetch(event.request).then((fetchResponse) => {
        // Cache successful responses
        if (fetchResponse && fetchResponse.status === 200) {
          const responseToCache = fetchResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return fetchResponse;
      });
    })
  );
});

// Background sync for audio context
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'groovebox-keep-alive') {
    event.waitUntil(keepAlive());
  }
});

// Push notification support for future features
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    
    const options = {
      body: data.body || 'GrooveBox Update',
      icon: '/favicon/favicon.svg',
      badge: '/favicon/favicon.svg',
      tag: 'groovebox-notification',
      requireInteraction: false,
      actions: [
        {
          action: 'open',
          title: 'Open App'
        },
        {
          action: 'dismiss',
          title: 'Dismiss'
        }
      ]
    };
    
    event.waitUntil(
      self.registration.showNotification(data.title || 'GrooveBox', options)
    );
  }
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'open') {
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        if (clients.length > 0) {
          clients[0].focus();
        } else {
          self.clients.openWindow('/');
        }
      })
    );
  }
});

// More aggressive background processing
self.addEventListener('backgroundfetchsuccess', (event) => {
  console.log('Background fetch successful:', event);
});

// Handle app updates
self.addEventListener('appinstalled', (event) => {
  console.log('GrooveBox app installed');
});

// Handle app launch
self.addEventListener('applaunch', (event) => {
  console.log('GrooveBox app launched');
});

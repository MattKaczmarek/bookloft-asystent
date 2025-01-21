// service-worker.js
// Pusty Service Worker – wymagany tylko do instalacji PWA (bez cachowania, bez obsługi fetch).

self.addEventListener('install', (event) => {
  // Natychmiast kończ instalację
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  // Przejmij kontrolę nad stroną od razu (bez czekania na przeładowanie)
  event.waitUntil(clients.claim());
});

// Brak obsługi fetch – nie przechwytuje i nie cache’uje żadnych zasobów.

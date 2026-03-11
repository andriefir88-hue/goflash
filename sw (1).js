// ==========================================
// sw.js - Service Worker (Background Worker)
// ==========================================

self.addEventListener('install', (event) => {
    console.log('✅ Service Worker Terinstal!');
    self.skipWaiting(); // Langsung aktif tanpa menunggu
});

self.addEventListener('activate', (event) => {
    console.log('✅ Service Worker Aktif & Siap Bekerja!');
    event.waitUntil(clients.claim());
});

// Menangkap event klik pada notifikasi
self.addEventListener('notificationclick', function(event) {
    event.notification.close(); // Tutup notifikasi setelah diklik
    
    // Arahkan kembali ke web Go Flash saat notifikasi diklik
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
            // Jika web sudah terbuka di tab, fokuskan ke tab itu
            for (var i = 0; i < clientList.length; i++) {
                var client = clientList[i];
                if (client.url.includes(self.registration.scope) && 'focus' in client) {
                    return client.focus();
                }
            }
            // Jika web tertutup, buka tab baru
            if (clients.openWindow) {
                return clients.openWindow('/');
            }
        })
    );
});
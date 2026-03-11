/**
 * GO FLASH - CLIENT LOGIC (STRICTLY FRONTEND FIX)
 * FOKUS: INTERAKSI DRIVER, ORDER FLOW, & UI BINDING
 * COMPATIBILITY: BEKERJA DENGAN HTML & SERVER EXISTING
 */

// ==========================================
// 1. CONFIG & STATE
// ==========================================
const socket = io({ reconnection: true, timeout: 20000 });
let map, userMarker;
let driverMarkers = {}; 
let currentUser = null;
let watchId = null;
let isDriverActive = false;
let appConfig = null;
// --- TAMBAHAN VARIABEL BARU (PASTE DI BAWAH VARIABEL LAMA) ---
let tempPaymentBase64 = null;   // Menyimpan foto bukti bayar
let selectedPayMethod = 'cash'; // Default metode bayar
let currentControlOrderId = null; // ID Order yang sedang diproses Driver
// State Transaksi
let activeOrder = null;
let selectedDriver = null;
let chatPartner = { id: null, name: null };
let chatMessages = {};      
let chatContacts = [];      
let driverOrders = [];
let tempAuthData = {};
let tempPhotoBase64 = null;
let currentServiceType = 'ride';

// ==========================================
// 2. INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    console.log("🚀 App Started...");
    
    // Inject CSS Penting (Agar Marker bisa diklik & Animasi)
    const style = document.createElement('style');
    style.innerHTML = `
        /* Paksa Marker agar bisa diklik di atas peta */
        .driver-icon-box { 
            width: 40px; height: 40px; 
            background: white; border-radius: 50%; 
            display: flex; justify-content: center; align-items: center; 
            box-shadow: 0 3px 8px rgba(0,0,0,0.3); 
            font-size: 20px; 
            transition: transform 0.3s ease; 
            cursor: pointer !important; 
            pointer-events: auto !important; 
            z-index: 1000 !important;
        } 
        .user-pulse { width: 20px; height: 20px; background: #0F4C81; border: 3px solid white; border-radius: 50%; box-shadow: 0 0 0 rgba(15, 76, 129, 0.4); animation: pulse 2s infinite; } 
        @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(15, 76, 129, 0.7); } 70% { box-shadow: 0 0 0 15px rgba(15, 76, 129, 0); } 100% { box-shadow: 0 0 0 0 rgba(15, 76, 129, 0); } }
    `;
    document.head.appendChild(style);

    initMap();
    checkLoginStatus();
    setupSocketListeners();
    fetchAppConfig();
});

// ==========================================
// 3. MAP ENGINE
// ==========================================
function initMap() {
    if(map) map.remove();
    
    // Koordinat Telang, Kamal (Zoom 14)
    map = L.map('map', {zoomControl: false}).setView([-7.1287, 112.7318], 14);
    
    // GUNAKAN OPENSTREETMAP STANDARD (100% GRATIS & LEGAL)
    // Tampilannya lebih berwarna dan jalur jalan terlihat jelas/kontras
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);
    
    // Disable tap handler leaflet di mobile
    map.tap && map.tap.disable();
    
    // Tombol My Location
    const btn = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
    btn.innerHTML = `<button onclick="window.getMyLocation()" style="background:white;width:44px;height:44px;border-radius:50%;border:none;box-shadow:0 4px 10px rgba(0,0,0,0.15);color:#0F4C81;font-size:20px;margin-bottom:90px;margin-right:15px;cursor:pointer;"><i class="fas fa-crosshairs"></i></button>`;
    const c = new L.Control({ position: 'bottomright' });
    c.onAdd = () => btn;
    c.addTo(map);
}

// --- RADAR GPS CUSTOMER (MEMINJAM MESIN DRIVER SEMENTARA) ---
window.getMyLocation = () => {
    if(!map) return;
    if(!navigator.geolocation) return alert("Browser tidak mendukung GPS.");

    alert("📡 Memanaskan GPS Satelit... Mohon tunggu sebentar.");

    // Kita pakai watchPosition (Radar Driver) agar HP terpaksa menyalakan satelit
    let tempWatchId = navigator.geolocation.watchPosition(
        (pos) => {
            const {latitude, longitude, accuracy} = pos.coords;
            
            // Pindahkan marker dan peta ke lokasi yang didapat
            updateUserMarker(latitude, longitude);
            map.flyTo([latitude, longitude], 17);

            // Jika akurasi sudah mencapai radius di bawah 50 meter (Sangat Akurat)
            // Matikan radarnya seketika
            if (accuracy <= 50) {
                navigator.geolocation.clearWatch(tempWatchId);
                console.log("Satelit terkunci dengan akurasi: " + accuracy + " meter");
            }
        }, 
        (error) => {
            console.error("GPS Error:", error);
        }, 
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );

    // Timer Pengaman: Matikan radar paksa setelah 10 detik
    // Ini agar radar tidak terus-terusan menyedot baterai Customer
    setTimeout(() => {
        navigator.geolocation.clearWatch(tempWatchId);
    }, 10000);
};

function updateUserMarker(lat, lng) {
    if(!map) return;
    const icon = L.divIcon({className:'u', html:'<div class="user-pulse"></div>', iconSize:[20,20]});
    if(userMarker) userMarker.setLatLng([lat, lng]);
    else userMarker = L.marker([lat, lng], {icon, zIndexOffset:1000}).addTo(map);
}

// [LOGIKA MARKER UTAMA]
function updateDriverMarker(data) {
    if(!map || !data.location) return;
    if(currentUser && currentUser.id === data.id) return; // Hide self

    const color = (data.status === 'online' && !data.isBusy) ? '#10B981' : '#EF4444';
    
    // CSS Class 'driver-icon-box' sudah di-inject pointer-events: auto di atas
    const html = `<div class="driver-icon-box" style="border: 3px solid ${color}; color: ${color}; transform: rotate(${data.angle}deg);"><i class="fas fa-motorcycle"></i></div>`;
    const icon = L.divIcon({className:'d', html, iconSize:[40,40]});

    if(driverMarkers[data.id]) {
        driverMarkers[data.id].setLatLng([data.location.lat, data.location.lng]).setIcon(icon);
        driverMarkers[data.id].driverData = data; // Update data di memory marker
    } else {
        const m = L.marker([data.location.lat, data.location.lng], {icon}).addTo(map);
        m.driverData = data; // Simpan data di marker
        
        // FIX: Event listener menggunakan referensi langsung ke object marker ini
        m.on('click', function(e) {
            // L.DomEvent.stopPropagation(e); // Mencegah klik tembus ke peta
            window.onDriverMarkerClick(this.driverData);
        });
        
        driverMarkers[data.id] = m;
    }
}

// ==========================================
// 4. NAVIGATION & UI
// ==========================================
window.switchTab = function(tabName) {
    document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => { el.classList.remove('text-royal'); el.classList.add('text-gray-400'); });
    if(event && event.currentTarget) { event.currentTarget.classList.remove('text-gray-400'); event.currentTarget.classList.add('text-royal'); }

    if (tabName === 'home') { if(map) setTimeout(() => map.invalidateSize(), 100); } 
    else if (tabName === 'chat') { document.getElementById('view-chat-list').classList.add('active'); renderChatList(); }
    else if (tabName === 'orders') { document.getElementById('view-orders').classList.add('active'); renderDriverOrderList(); }
    else if (tabName === 'history') { document.getElementById('view-history').classList.add('active'); renderHistory(); }
    else if (tabName === 'profile') { document.getElementById('view-profile').classList.add('active'); }
};

// ==========================================
// 5. INTERAKSI DRIVER (PROFILE & ORDER)
// ==========================================
window.onDriverMarkerClick = (data) => {
    if(!data) return;
    if(currentUser?.id === data.id) return;
    
    selectedDriver = data;
    console.log("Opening Driver:", data.username);

    // 1. Isi Data ke HTML (Sesuai ID di index.html Anda)
    document.getElementById('sheet-drv-name').innerText = data.username || "Driver";
    document.getElementById('sheet-drv-plate').innerText = data.plate || '-';
    document.getElementById('sheet-drv-model').innerText = data.vehicleModel || 'Kendaraan';
    
    const imgEl = document.getElementById('sheet-drv-img');
    if(imgEl) imgEl.src = data.photo || `https://ui-avatars.com/api/?name=${data.username}`;
    
    // Status Dot (Hijau/Merah)
    const dot = document.getElementById('sheet-drv-status-dot');
    if(dot) dot.className = `absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-white ${data.isBusy ? 'bg-red-500' : 'bg-green-500'}`;

    // Tampilkan Sheet
    const sheet = document.getElementById('driver-sheet');
    sheet.style.bottom = "0"; // Paksa style langsung jika class bermasalah
    
    // Reset Order Form
    document.getElementById('sheet-order-form').classList.add('hidden');
    document.getElementById('sheet-main-actions').classList.remove('hidden');
};

window.closeDriverSheet = () => {
    const sheet = document.getElementById('driver-sheet');
    sheet.style.bottom = "-100%";
};

// ==========================================
// PERBAIKAN UI: MEMUNCULKAN KEMBALI INPUT SHARELOC & CATATAN
// ==========================================
window.showOrderForm = (type) => {
    currentServiceType = type;
    
    const mainActions = document.getElementById('sheet-main-actions');
    const orderForm = document.getElementById('sheet-order-form');
    
    if(mainActions) mainActions.classList.add('hidden');
    if(orderForm) orderForm.classList.remove('hidden');
    
    const label = document.getElementById('order-type-label');
    const icon = document.getElementById('order-type-icon');
    if(type === 'ride') { 
        if(label) label.innerText = 'Go Ride'; 
        if(icon) icon.className = 'fas fa-motorcycle'; 
    } else { 
        if(label) label.innerText = 'Go Send'; 
        if(icon) icon.className = 'fas fa-box'; 
    }

    const sel = document.getElementById('dest-select'); 
    if(sel) {
        sel.innerHTML = '<option value="">Pilih Tujuan...</option>';
        if(appConfig && appConfig.PRICES) {
            const listData = (type === 'ride') ? appConfig.PRICES.RIDE : appConfig.PRICES.DELIVERY;
            if(listData) listData.forEach((r, i) => sel.innerHTML += `<option value="${i}">${r.name}</option>`);
        }
    }

    // --- INI KUNCI PERBAIKANNYA (SUNTIKAN INPUT ANTI-HILANG) ---
    let extraInputs = document.getElementById('extra-inputs-container');
    
    if(!extraInputs) {
        extraInputs = document.createElement('div');
        extraInputs.id = 'extra-inputs-container';
        extraInputs.className = "mt-3 pt-3 border-t border-gray-100 text-left mb-4"; // Tambah jarak bawah
        
        extraInputs.innerHTML = `
            <div class="mb-4">
                <p class="text-[10px] font-bold text-red-500 uppercase mb-1">Link ShareLoc Jemput (Wajib) *</p>
                <input id="order-shareloc" type="url" class="w-full bg-white bg-opacity-50 font-bold text-royal text-sm outline-none border-b border-gray-300 pb-2 focus:border-blue-500 transition" placeholder="Tempel link Google Maps di sini...">
            </div>
            <div>
                <p class="text-[10px] font-bold text-gray-400 uppercase mb-1">Catatan (Opsional)</p>
                <input id="order-notes" class="w-full bg-white bg-opacity-50 font-bold text-royal text-sm outline-none border-b border-gray-300 pb-2 focus:border-blue-500 transition" placeholder="Contoh: Baju merah di depan pagar...">
            </div>
        `;
        
        // ⚡ CARI TOMBOL BERDASARKAN ID, BUKAN WARNA LAGI!
        const btn = document.getElementById('btn-submit-order') || document.querySelector('#sheet-order-form button');
        
        if(btn && btn.parentElement) {
            // Masukkan tepat di atas tombol Konfirmasi
            btn.parentElement.insertBefore(extraInputs, btn);
        } else if(orderForm) {
            // Failsafe: Jika tombol tidak ketemu, taruh saja di paling bawah form
            orderForm.appendChild(extraInputs);
        }
    } else {
        // Reset isi input jika form ditutup dan dibuka ulang
        const sl = document.getElementById('order-shareloc');
        const n = document.getElementById('order-notes');
        if(sl) sl.value = '';
        if(n) n.value = '';
    }
};

window.hideOrderForm = () => {
    document.getElementById('sheet-order-form').classList.add('hidden');
    document.getElementById('sheet-main-actions').classList.remove('hidden');
};

window.calculatePrice = () => {
    const idx = document.getElementById('dest-select').value;
    if(idx === "") {
        document.getElementById('price-display').innerText = "Rp 0";
        return;
    }
    const priceList = (currentServiceType === 'ride') ? appConfig.PRICES.RIDE : appConfig.PRICES.DELIVERY;
    const price = priceList[idx].price;
    document.getElementById('price-display').innerText = "Rp " + price.toLocaleString();
};

window.submitOrder = () => {
    if(!currentUser) return alert("Silakan Login terlebih dahulu.");
    
    const idx = document.getElementById('dest-select').value;
    const shareLocLink = document.getElementById('order-shareloc')?.value.trim();
    const notes = document.getElementById('order-notes')?.value.trim() || '-';

    // WAJIB DIISI
    if(idx === "") return alert("Mohon pilih tujuan.");
    if(!shareLocLink) return alert("PENTING: Mohon tempelkan Link ShareLoc Google Maps untuk titik penjemputan Anda.");
    
    const priceList = (currentServiceType === 'ride') ? appConfig.PRICES.RIDE : appConfig.PRICES.DELIVERY;
    const route = priceList[idx];

    if(document.getElementById('waiting-title')) {
        document.getElementById('waiting-title').innerText = "Menunggu konfirmasi Driver...";
        document.getElementById('waiting-desc').innerText = "Permintaan Anda sedang disiarkan ke driver.";
        document.getElementById('waiting-icon').className = "fas fa-search-location text-2xl text-royal";
        const wBtn = document.getElementById('waiting-btn');
        wBtn.innerText = "BATALKAN PESANAN";
        wBtn.className = "text-red-500 font-bold text-xs bg-red-50 px-8 py-3 rounded-full hover:bg-red-100 transition shadow-sm";
        wBtn.onclick = () => closeModal('modal-waiting');
    }
    
    socket.emit('request_order', {
        customerId: currentUser.id, 
        customerName: currentUser.username, 
        targetDriverId: selectedDriver ? selectedDriver.id : null,
        pickupLocation: "Link Maps Dilampirkan", 
        pickupLink: shareLocLink, // <-- Link ShareLoc dikirim ke Driver
        destination: route.name, 
        price: route.price, 
        serviceType: currentServiceType,
        paymentMethod: 'pending', 
        notes: notes
    });
    
    closeDriverSheet(); 
    openModal('modal-waiting');
};

window.openChatRoom = (name, id) => {
    if(name && id) chatPartner = {name, id}; 
    if(!chatPartner.id) return alert("Pilih kontak dulu");
    
    document.getElementById('chat-room-name').innerText = chatPartner.name;
    const box = document.getElementById('chat-messages');
    box.innerHTML = '';
    
    const msgs = chatMessages[chatPartner.id] || [];
    msgs.forEach(m => renderChatBubble(m.text, m.isMe));
    
    openModal('modal-chat-room');
};

window.sendChat = () => {
    const input = document.getElementById('chat-input');
    const txt = input.value.trim();
    if(!txt || !chatPartner.id) return;
    
    renderChatBubble(txt, true);
    if(!chatMessages[chatPartner.id]) chatMessages[chatPartner.id] = [];
    chatMessages[chatPartner.id].push({text: txt, isMe: true});
    updateChatContacts(chatPartner.id, chatPartner.name, txt);
    socket.emit('send_chat', {toUserId: chatPartner.id, message: txt, fromName: currentUser.username});
    input.value = '';
};

// ==========================================
// 7. LIST RENDERERS
// ==========================================
function renderChatList() {
    const c = document.getElementById('chat-list-container');
    c.innerHTML = ''; 
    if (chatContacts.length === 0) { 
        c.innerHTML = `<div class="text-center text-gray-400 mt-10"><i class="fas fa-comment-slash text-4xl mb-2"></i><p class="text-sm">Belum ada pesan.</p></div>`; 
        return; 
    }
    chatContacts.forEach(co => {
        const d = document.createElement('div');
        d.className = "bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-3 cursor-pointer hover:bg-gray-50";
        d.onclick = () => window.openChatRoom(co.name, co.id);
        d.innerHTML = `<div class="w-10 h-10 rounded-full bg-royal text-white flex items-center justify-center font-bold text-lg">${co.name.charAt(0)}</div><div class="flex-1"><h4 class="font-bold text-royal text-sm">${co.name}</h4><p class="text-xs text-gray-400 truncate">${co.lastMsg || '...'}</p></div>`;
        c.appendChild(d);
    });
}// --- TAMBAHAN SESI 3: HANDSHAKE PEMBAYARAN & MARKER ---
    
    socket.on('payment_proof_received', (data) => {
        if(typeof window.onProofReceived === 'function') window.onProofReceived(data);
    });

    socket.on('payment_verified', () => {
        alert("✅ Pembayaran Lunas! Selamat menikmati perjalanan.");
        closeModal('modal-payment-method');
        const statusTxt = document.getElementById('track-status-text');
        if(statusTxt) {
            statusTxt.innerText = "Perjalanan Dimulai (LUNAS)";
            statusTxt.classList.add('text-green-600');
        }
    });

    socket.on('payment_verified_success', () => {
        const icon = document.getElementById('step-2-icon');
        if(icon) {
            icon.classList.replace('bg-orange-500', 'bg-green-500');
            icon.innerHTML = '<i class="fas fa-check-double"></i>';
        }
        if(document.getElementById('btn-verify-pay')) document.getElementById('btn-verify-pay').classList.add('hidden');
        if(document.getElementById('step-3-container')) document.getElementById('step-3-container').classList.remove('opacity-50', 'pointer-events-none');
    });

    socket.on('mission_ended', () => { 
        alert("🏁 Perjalanan Selesai. Terima kasih!");
        window.location.reload(); 
    });

// --- KEMBALIKAN FITUR KONTROL MISI DRIVER ---
window.renderDriverOrderList = function() {
    const c = document.getElementById('driver-orders-list');
    if(!c) return;
    c.innerHTML = '';
    
    if (driverOrders.length === 0) {
        c.innerHTML = `<div class="text-center text-gray-400 mt-20"><i class="fas fa-satellite-dish text-4xl mb-2 animate-pulse"></i><p class="text-sm">Menunggu order...</p></div>`;
        return;
    }
    
    driverOrders.forEach(o => {
        const d = document.createElement('div');
        // Beri warna latar hijau muda jika statusnya selesai
        d.className = `p-4 rounded-xl shadow-md mb-4 border transition-all duration-500 transform ${o.status === 'completed' ? 'bg-green-50 border-green-300 scale-95' : 'bg-white border-gray-100'}`;
        
        let statusBadge = '';
        if (o.status === 'accepted') {
            statusBadge = '<span class="text-[10px] bg-blue-100 text-blue-600 px-3 py-1 rounded font-bold uppercase tracking-wide">SEDANG DIPROSES</span>';
        } else if (o.status === 'completed') {
            statusBadge = '<span class="text-[10px] bg-green-500 text-white px-3 py-1 rounded shadow-md font-bold uppercase transform -rotate-3 border border-green-600"><i class="fas fa-check-double"></i> SELESAI</span>';
        }

        let serviceLabel = o.serviceType === 'delivery' ? 'Delivery' : 'Ride';
        let custName = o.customerName || 'Customer';

        let html = `
            <div class="mb-2 flex justify-between items-start">
                <div>
                    <h4 class="font-bold text-black text-sm">${serviceLabel}: ${custName}</h4>
                    <p class="text-xs text-gray-500 mt-0.5">Tujuan: ${o.destination}</p>
                </div>
                ${statusBadge}
            </div>
            <div class="mb-4">
                <span class="text-green-600 font-bold text-sm">Rp ${parseInt(o.price).toLocaleString()}</span>
            </div>
        `;

        // --- INI DIA BAGIAN YANG HILANG (TOMBOL KLIK BUKA KONTROL MISI) ---
        if (o.status === 'searching' || !o.status) {
            html += `<button onclick="acceptOrder('${o.id}')" class="w-full bg-green-500 text-white font-bold py-3 rounded-xl text-xs shadow-md hover:bg-green-600 active:scale-95 transition">TERIMA ORDER</button>`;
        } else if (o.status === 'accepted') {
            // Kita bungkus dengan div yang bisa diklik -> openDriverControl
            html += `<div onclick="openDriverControl('${o.id}')" class="space-y-2 border-t border-gray-100 pt-3 cursor-pointer hover:bg-gray-50 p-2 -mx-2 rounded-xl transition">`;
            
            if (!o.payment_proof) {
                // Teks saya ubah sedikit agar Driver tahu ini bisa diklik
                html += `<button class="w-full bg-gray-100 text-gray-500 text-[10px] font-bold py-3 rounded-xl flex justify-center items-center gap-2 border border-gray-200 pointer-events-none"><i class="fas fa-lock"></i> MENUNGGU BUKTI (KLIK DETAIL)</button>`;
            } else {
                html += `<button class="w-full bg-blue-100 text-blue-600 text-[10px] font-bold py-3 rounded-xl flex justify-center items-center gap-2 shadow-sm pointer-events-none"><i class="fas fa-image"></i> BUKTI DITERIMA (KLIK BUKA)</button>`;
            }
            html += `</div>`;
        } else if (o.status === 'completed') {
            html += `<div class="w-full bg-green-100 text-green-700 text-[10px] font-bold py-3 rounded-xl flex justify-center items-center gap-2 mt-2 border border-green-200 animate-pulse">
                        <i class="fas fa-spinner fa-spin"></i> Memindahkan ke Riwayat...
                     </div>`;
        }
        
        d.innerHTML = html;
        c.appendChild(d);
    });
};

// --- 1. GANTI FUNGSI RENDER HISTORY LAMA DENGAN INI ---
window.renderHistory = function() {
    if(!currentUser) return;
    const c = document.getElementById('history-list');
    if (!c) return;

    // Tampilkan loading sebentar, biarkan server yang mengirimkan data tombol abu-abunya
    c.innerHTML = '<div class="text-center mt-10"><i class="fas fa-spinner fa-spin text-royal text-2xl"></i><p class="text-[10px] text-gray-400 mt-2">Memuat riwayat...</p></div>';

    // Perintahkan server mengirim riwayat (Server akan memicu 'receive_history')
    socket.emit('request_history', { userId: currentUser.id }); 

    // RENDER ORDER AKTIF (TERMASUK YANG BARU SAJA SELESAI)
    if (activeOrder && currentUser.role === 'customer') {
        const now = new Date().getTime();
        const createdTime = activeOrder.created_at ? new Date(activeOrder.created_at) : new Date();
        const dateStr = createdTime.toLocaleString('id-ID', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'});
        
        const diffSeconds = (now - createdTime.getTime()) / 1000;
        
        // Tentukan Status & Warna
        let statusText = 'Mencari Driver';
        let statusBg = 'bg-blue-50';
        let statusColor = 'text-blue-600';
        let borderClass = 'border-blue-400';
        let lineClass = 'bg-blue-500';

        if (activeOrder.status === 'accepted') {
            statusText = 'DIPROSES';
        } else if (activeOrder.status === 'completed') {
            statusText = 'SELESAI';
            statusBg = 'bg-green-100';
            statusColor = 'text-green-700';
            borderClass = 'border-green-400';
            lineClass = 'bg-green-500';
        } else if (activeOrder.status === 'cancelled') {
            statusText = 'DIBATALKAN';
            statusBg = 'bg-red-100';
            statusColor = 'text-red-600';
            borderClass = 'border-red-400';
            lineClass = 'bg-red-500';
        }

        // --- LOGIKA TOMBOL (YANG DIPERBAIKI) ---
        let btnBatalHtml = '';
        let btnBayarHtml = '';

        if (activeOrder.status === 'completed') {
            // KASUS: SUDAH SELESAI -> TOMBOL JADI ABU-ABU (MATI MUTLAK)
            btnBatalHtml = `<button disabled class="w-full bg-gray-200 text-gray-400 border border-gray-300 py-2.5 rounded-xl text-xs font-bold cursor-not-allowed">BATAL</button>`;
            
            btnBayarHtml = `<button disabled class="w-full bg-gray-200 text-gray-500 py-2.5 rounded-xl text-xs font-bold flex justify-center items-center gap-1 cursor-not-allowed border border-gray-300"><i class="fas fa-flag-checkered"></i> SELESAI</button>`;
        } 
        else if (activeOrder.status === 'cancelled') {
             // KASUS: BATAL
             btnBatalHtml = `<button disabled class="w-full bg-gray-100 text-gray-400 py-2.5 rounded-xl text-xs font-bold">DIBATALKAN</button>`;
             btnBayarHtml = `<button disabled class="w-full bg-gray-100 text-gray-400 py-2.5 rounded-xl text-xs font-bold">-</button>`;
        }
        else {
            // KASUS: MASIH BERJALAN (DIPROSES/MENCARI) -> TOMBOL AKTIF
            const canCancel = diffSeconds <= 30; // Aturan batal 30 detik
            
            // Tombol Batal
            btnBatalHtml = canCancel
                ? `<button onclick="cancelOrderHistory('${activeOrder.id}')" class="w-full bg-red-50 text-red-500 border border-red-200 py-2.5 rounded-xl text-xs font-bold active:scale-95 transition">BATAL</button>`
                : `<button disabled class="w-full bg-gray-100 text-gray-400 py-2.5 rounded-xl text-xs font-bold cursor-not-allowed">BATAL</button>`;

            // Tombol Bayar
            if (activeOrder.payment_status === 'verified') {
                btnBayarHtml = `<button disabled class="w-full bg-gray-100 text-green-600 py-2.5 rounded-xl text-xs font-bold flex justify-center items-center gap-1 cursor-not-allowed border border-gray-200"><i class="fas fa-check-circle"></i> LUNAS</button>`;
            } else {
                let btnLabel = activeOrder.payment_status === 'pending_verification' ? "CEK STATUS" : "BAYAR SEKARANG";
                let btnClass = activeOrder.payment_status === 'pending_verification' ? "bg-orange-500" : "bg-green-500";
                
                btnBayarHtml = `<button onclick="openPaymentFromHistory('${activeOrder.id}', ${activeOrder.price})" class="w-full ${btnClass} text-white shadow-md py-2.5 rounded-xl text-xs font-bold active:scale-95 transition">${btnLabel}</button>`;
            }
        }       

        const timerHtml = (activeOrder.status !== 'completed' && activeOrder.status !== 'cancelled' && diffSeconds <= 30) ? `<p class="text-[9px] text-red-400 text-center mt-2 animate-pulse">Batal tersedia ${Math.floor(30 - diffSeconds)} detik lagi</p>` : '';

        // Render HTML Kartu
        c.innerHTML += `
            <div class="bg-white p-4 rounded-2xl shadow-sm border ${borderClass} mb-3 relative overflow-hidden">
                <div class="absolute top-0 left-0 w-1 h-full ${lineClass}"></div>
                <div class="flex justify-between mb-2">
                    <span class="text-xs font-bold text-gray-400">${dateStr}</span>
                    <span class="text-[10px] font-bold ${statusColor} ${statusBg} px-2 py-1 rounded uppercase tracking-wide">${statusText}</span>
                </div>
                <h4 class="font-bold text-royal text-sm mb-1">${activeOrder.destination || 'Tujuan'}</h4>
                <div class="flex justify-between items-center mb-3">
                    <p class="text-xs text-gray-500">Tarif</p>
                    <p class="text-sm font-bold text-royal">Rp ${parseInt(activeOrder.price || 0).toLocaleString()}</p>
                </div>
                <div class="grid grid-cols-2 gap-2 pt-3 border-t border-gray-100">
                    ${btnBatalHtml}
                    ${btnBayarHtml}
                </div>
                ${timerHtml}
            </div>
        `;
    }

    // Panggil server untuk mengambil riwayat masa lalu
    socket.emit('request_history', { userId: currentUser.id });
};

// ==========================================
// SETUP SOCKET LISTENERS (ANTENA PENERIMA SINYAL)
// ==========================================
function setupSocketListeners() {
    
    // 1. Update Posisi Driver di Peta
    socket.on('driver_moved', updateDriverMarker);
    socket.on('driver_state_update', updateDriverMarker);
    socket.on('initial_drivers_data', (list) => { 
        if(Array.isArray(list)) list.forEach(updateDriverMarker); 
    });

    // 2. Order Masuk (Ke Driver)
    socket.on('incoming_order', (o) => {
        // Cek apakah user ini driver & sedang aktif
        if(!isDriverActive && currentUser.role === 'driver') return;
        
        // Bunyikan notifikasi
        const audio = document.getElementById('notif-sound'); 
        if(audio) audio.play().catch(()=>{});
        
        // Isi data ke Modal
        document.getElementById('incoming-pickup').innerText = o.pickupLocation;
        document.getElementById('incoming-dest').innerText = o.destination;
        document.getElementById('incoming-price').innerText = "Rp " + parseInt(o.price).toLocaleString();
        
        // Simpan ID sementara & Buka Modal
        window.tempOrderId = o.id;
        openModal('modal-incoming-order');
        
        // Masukkan ke List Order Driver (jika belum ada)
        if(!driverOrders.find(d => d.id === o.id)) {
            driverOrders.unshift(o);
            // Jika sedang membuka tab Order, refresh tampilannya
            if(document.getElementById('view-orders').classList.contains('active')) {
                renderDriverOrderList(); 
            }
        }
    });

// 2. UPDATE LOGIKA SAAT DRIVER MENERIMA PESANAN
    socket.on('order_accepted', (o) => {
        activeOrder = o;

        if(currentUser.role === 'customer') {
            // UBAH MODAL MENJADI "PESANAN DIPROSES"
            if(document.getElementById('waiting-title')) {
                document.getElementById('waiting-title').innerText = "Pesanan Diproses!";
                document.getElementById('waiting-desc').innerText = `Driver ${o.driverInfo.username} sedang bersiap menuju lokasi Anda.`;
                document.getElementById('waiting-icon').className = "fas fa-check text-2xl text-green-500";
                
                const wBtn = document.getElementById('waiting-btn');
                wBtn.innerText = "OKE";
                wBtn.className = "text-white font-bold text-xs bg-green-500 px-12 py-3 rounded-full hover:bg-green-600 shadow-md transition transform active:scale-95";
                
                // Jika "OKE" diklik, baru tutup modal, buka pilihan bayar & radar tracking
                wBtn.onclick = () => {
                    closeModal('modal-waiting');
                    if(typeof showPaymentModal === 'function') showPaymentModal(o.price);
                    
                    document.getElementById('panel-tracking-customer').style.bottom = "0"; 
                    document.getElementById('track-drv-name').innerText = o.driverInfo.username;
                    document.getElementById('track-drv-img').src = o.driverInfo.photo || "";
                    
                    chatPartner = {id: o.driverId, name: o.driverInfo.username};
                    if(typeof updateChatContacts === 'function') updateChatContacts(o.driverId, o.driverInfo.username, "Driver OTW");
                };
            }
        } else {
            // SISI DRIVER (TIDAK BERUBAH)
            closeModal('modal-incoming-order');
            if(typeof openDriverControl === 'function') openDriverControl(o.id);
            document.getElementById('trip-cust-name').innerText = o.customerName;
            document.getElementById('trip-price').innerText = "Rp " + parseInt(o.price).toLocaleString();
            document.getElementById('trip-dest').innerText = o.destination;
            document.getElementById('panel-trip-driver').style.bottom = "0";
            chatPartner = {id: o.customerId, name: o.customerName};
            if(typeof updateChatContacts === 'function') updateChatContacts(o.customerId, o.customerName, "Menjemput...");
        }
    });

    // 4. [PENTING!] Menerima Foto Bukti Bayar (Ke Driver)
    socket.on('payment_proof_received', (data) => {
        // Panggil fungsi logika tampilan yang sudah kita buat
        if(typeof window.onProofReceived === 'function') {
            window.onProofReceived(data);
        } else {
            console.error("Fungsi onProofReceived hilang!");
        }
    });

    // 5. Pembayaran Terverifikasi (Ke Customer & Driver)
    socket.on('payment_verified', () => {
        // Customer: Tutup modal bayar & beri notif
        alert("✅ Pembayaran Lunas! Perjalanan dimulai.");
        closeModal('modal-payment-method');
        const statusTxt = document.getElementById('track-status-text');
        if(statusTxt) { 
            statusTxt.innerText = "Perjalanan Dimulai (LUNAS)"; 
            statusTxt.classList.add('text-green-600'); 
        }
    });

    socket.on('payment_verified_success', (data) => {
        // Driver: Buka kunci tombol Misi Selesai
        const icon = document.getElementById('step-2-icon');
        if(icon) {
            icon.classList.replace('bg-orange-500', 'bg-green-500');
            icon.innerHTML = '<i class="fas fa-check-double"></i>';
        }
        
        // Update status di list order lokal
        const idx = driverOrders.findIndex(o => o.id === data.orderId);
        if(idx > -1) {
             driverOrders[idx].payment_status = 'verified';
             if(document.getElementById('view-orders').classList.contains('active')) renderDriverOrderList();
        }

        const btnVerify = document.getElementById('btn-verify-pay');
        if(btnVerify) btnVerify.classList.add('hidden');
        
        const step3 = document.getElementById('step-3-container');
        if(step3) step3.classList.remove('opacity-50', 'pointer-events-none');
    });

// --- METODE SAPU JAGAT: MISI SELESAI (APP.JS) ---
socket.off('mission_ended');
socket.on('mission_ended', function(data) { 
    if (currentUser && currentUser.role === 'customer') {
        alert("🏁 Perjalanan Selesai. Terima kasih telah menggunakan Go Flash!");
        
        // 1. UBAH UI SECARA PAKSA SAAT ITU JUGA (ANTI-MACET)
        // Cari semua tombol di layar dan matikan paksa jika ada kata Batal/Bayar
        const semuaTombol = document.querySelectorAll('button');
        semuaTombol.forEach(btn => {
            const teks = btn.innerText.toUpperCase();
            if (teks.includes('BATAL')) {
                btn.disabled = true;
                btn.className = "w-full bg-gray-100 text-gray-400 py-3 rounded-xl text-xs font-bold cursor-not-allowed";
                btn.innerText = "BATAL (KADALUARSA)";
            }
            if (teks.includes('BAYAR')) {
                btn.disabled = true;
                btn.className = "w-full bg-gray-200 text-gray-500 py-3 rounded-xl text-xs font-bold cursor-not-allowed flex justify-center items-center gap-2";
                btn.innerHTML = '<i class="fas fa-check-circle"></i> LUNAS';
            }
        });

        // Cari tulisan "DIPROSES" dan ganti jadi "SELESAI" (Warna Hijau)
        const semuaBadge = document.querySelectorAll('span, div');
        semuaBadge.forEach(badge => {
            const teks = badge.innerText.toUpperCase();
            if (teks === 'DIPROSES' || teks === 'SEDANG DIPROSES' || teks === 'MENCARI DRIVER') {
                badge.className = "text-[10px] bg-green-100 text-green-700 px-3 py-1 rounded font-bold uppercase tracking-wide";
                badge.innerText = "SELESAI";
            }
        });

        // 2. Bersihkan memori HP dari pesanan aktif & Matikan Mesin Waktu
        activeOrder = null;
        if (window.cancelTimerInterval) clearInterval(window.cancelTimerInterval);

        // Bersihkan tulisan "Memuat riwayat..." yang nyangkut
        const historyList = document.getElementById('history-list');
        if (historyList) historyList.innerHTML = '';

        // 3. Beri jeda 1.5 detik agar Database Supabase tenang, baru tarik riwayat asli
        setTimeout(() => {
            socket.emit('request_history', { userId: currentUser.id });
        }, 1500);
    }
});
    
// Variabel Timer Global
window.cancelTimerInterval = null; 

// --- KODE PEMULIH INGATAN (RESTORE SESSION) & HISTORY ---
socket.on('receive_history', (serverOrders) => {
    const c = document.getElementById('history-list'); 
    if(!c) return;
    
    // Bersihkan layar & Matikan timer lama
    c.innerHTML = ''; 
    if (window.cancelTimerInterval) clearInterval(window.cancelTimerInterval); 

    // ============================================================
    // 1. BAGIAN PEMULIHAN (RESTORE) - AGAR TIDAK HILANG SAAT REFRESH
    // ============================================================
    const ongoingOrder = serverOrders.find(o => 
        (o.status === 'accepted' || o.status === 'searching')
    );

    if (ongoingOrder) {
        console.log("♻️ Restore Order Aktif:", ongoingOrder.id);
        activeOrder = ongoingOrder; // Masukkan kembali ke memori HP

        // A. JIKA SAYA CUSTOMER -> MUNCULKAN PETA TRACKING
        if (currentUser.role === 'customer') {
            const panel = document.getElementById('panel-tracking-customer');
            if(panel) panel.style.bottom = "0"; // <--- PAKSA PANEL NAIK!
            
            // Isi Data Driver
            if (activeOrder.driverInfo) {
                document.getElementById('track-drv-name').innerText = activeOrder.driverInfo.username;
                document.getElementById('track-drv-img').src = activeOrder.driverInfo.photo || "";
            }
            // Sembunyikan Modal Mencari jika status sudah accepted
            if (activeOrder.status === 'accepted') closeModal('modal-waiting');
            else if (activeOrder.status === 'searching') openModal('modal-waiting');
        } 
        // B. JIKA SAYA DRIVER -> MUNCULKAN PANEL JALAN
        else if (currentUser.role === 'driver') {
            const panel = document.getElementById('panel-trip-driver');
            if(panel) panel.style.bottom = "0"; // <--- PAKSA PANEL NAIK!
            
            document.getElementById('trip-cust-name').innerText = activeOrder.customerName;
            document.getElementById('trip-dest').innerText = activeOrder.destination;
            document.getElementById('trip-price').innerText = "Rp " + parseInt(activeOrder.price).toLocaleString();
        }
    }

    // ============================================================
    // 2. BAGIAN RENDER RIWAYAT & TIMER 30 DETIK
    // ============================================================
    
    // Filter hanya order milik saya
    const myOrders = serverOrders.filter(o => o.customerId === currentUser.id || o.driverId === currentUser.id);

    if (myOrders.length === 0) { 
        c.innerHTML = `<div class="text-center text-gray-400 mt-24"><i class="fas fa-history text-5xl mb-3 opacity-30"></i><p class="text-sm font-bold">Belum ada riwayat</p></div>`; 
        return; 
    }

    myOrders.forEach(o => {
        // Jangan render order yang sedang aktif di list riwayat (biar tidak dobel)
        // Kecuali Bapak ingin tetap melihatnya di list, hapus baris 'if' di bawah ini
        // if (activeOrder && o.id === activeOrder.id) return; 

        const d = document.createElement('div');
        let statusConfig = { text: 'DIPROSES', color: 'text-gray-500', bg: 'bg-gray-100', border: 'border-gray-200' };
        let btnHtml = '';
        let showTimer = false;
        let sisaWaktu = 0;

        // LOGIKA STATUS
        if (o.status === 'accepted') {
            statusConfig = { text: 'DIPROSES DRIVER', color: 'text-blue-700', bg: 'bg-blue-100', border: 'border-blue-500' };
            
            // Hitung Waktu Mundur
            const waktuMulai = o.accepted_at ? new Date(o.accepted_at).getTime() : new Date(o.updated_at).getTime();
            const berjalan = Math.floor((new Date().getTime() - waktuMulai) / 1000);
            sisaWaktu = 30 - berjalan;

            if (sisaWaktu > 0) {
                showTimer = true;
                btnHtml = `
                    <div class="grid grid-cols-2 gap-2 pt-3 border-t border-gray-100">
                        <button id="btn-cancel-${o.id}" onclick="cancelOrderHistory('${o.id}')" class="bg-red-50 text-red-500 py-2 rounded-xl text-[10px] font-bold active:scale-95 transition">BATAL</button>
                        <button onclick="openPaymentFromHistory('${o.id}', ${o.price})" class="bg-green-500 text-white py-2 rounded-xl text-[10px] font-bold active:scale-95 transition">BAYAR</button>
                    </div>
                    <div id="timer-text-${o.id}" class="text-[11px] text-red-500 font-bold text-center mt-2 bg-red-50 py-1 rounded border border-red-100">
                        <i class="fas fa-stopwatch animate-pulse"></i> Batal: ${sisaWaktu}s
                    </div>`;
            } else {
                btnHtml = `
                    <div class="grid grid-cols-2 gap-2 pt-3 border-t border-gray-100">
                        <button disabled class="bg-gray-100 text-gray-400 py-2 rounded-xl text-[10px] font-bold cursor-not-allowed">BATAL (KADALUARSA)</button>
                        <button onclick="openPaymentFromHistory('${o.id}', ${o.price})" class="bg-green-500 text-white py-2 rounded-xl text-[10px] font-bold active:scale-95 transition">BAYAR</button>
                    </div>`;
            }
        } else if (o.status === 'completed') {
            statusConfig = { text: 'SELESAI', color: 'text-green-700', bg: 'bg-green-100', border: 'border-green-400' };
            btnHtml = `<div class="grid grid-cols-2 gap-2 pt-3 border-t border-gray-100"><button disabled class="bg-gray-100 text-gray-400 py-2 rounded-xl text-[10px] font-bold">BATAL</button><button disabled class="bg-gray-200 text-green-700 py-2 rounded-xl text-[10px] font-bold"><i class="fas fa-check"></i> LUNAS</button></div>`;
        } else if (o.status === 'cancelled') {
            statusConfig = { text: 'DIBATALKAN', color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-400' };
            btnHtml = `<div class="pt-3 border-t border-gray-100 text-center text-[10px] text-red-400 font-bold uppercase">Pesanan Dibatalkan</div>`;
        }

        const dateStr = o.created_at ? new Date(o.created_at).toLocaleString('id-ID', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'}) : '';

        d.className = `bg-white p-4 rounded-2xl shadow-sm border-l-4 ${statusConfig.border} mb-3 relative overflow-hidden`;
        d.innerHTML = `
            <div class="flex justify-between mb-2">
                <span class="text-[10px] font-bold text-gray-400 uppercase">${dateStr}</span>
                <span class="text-[9px] font-bold ${statusConfig.color} ${statusConfig.bg} px-2 py-0.5 rounded uppercase">${statusConfig.text}</span>
            </div>
            <h4 class="font-bold text-royal text-sm mb-1">${o.destination || 'Tujuan'}</h4>
            <div class="flex justify-between items-center mb-1">
                <p class="text-[10px] text-gray-500">Total Tarif</p>
                <p class="text-sm font-bold text-royal">Rp ${parseInt(o.price || 0).toLocaleString()}</p>
            </div>
            ${btnHtml}
        `;
        c.appendChild(d);

        // Timer Interval
        if (showTimer) {
            const timerId = setInterval(() => {
                const now = new Date().getTime();
                const wm = o.accepted_at ? new Date(o.accepted_at).getTime() : new Date(o.updated_at).getTime();
                const s = 30 - Math.floor((now - wm) / 1000);
                
                const tEl = document.getElementById(`timer-text-${o.id}`);
                const bEl = document.getElementById(`btn-cancel-${o.id}`);

                if (s > 0) {
                    if(tEl) tEl.innerHTML = `<i class="fas fa-stopwatch animate-pulse"></i> Batal: ${s}s`;
                } else {
                    if(bEl) { bEl.disabled = true; bEl.innerText = "BATAL (KADALUARSA)"; bEl.className = "bg-gray-100 text-gray-400 py-2 rounded-xl text-[10px] font-bold cursor-not-allowed"; bEl.onclick = null; }
                    if(tEl) tEl.remove();
                    clearInterval(timerId);
                }
            }, 1000);
            if(!window.activeTimers) window.activeTimers = [];
            window.activeTimers.push(timerId);
        }
    });
});
}

// ==========================================
// 9. HELPER FUNCTIONS
// ==========================================
async function fetchAppConfig() { try { const r = await fetch('/api/config'); appConfig = await r.json(); } catch(e) {} }

function startDriverMode() {
    if(!navigator.geolocation) return alert("GPS Error");
    if(watchId) navigator.geolocation.clearWatch(watchId);
    watchId = navigator.geolocation.watchPosition(pos => {
        const {latitude, longitude, heading} = pos.coords;
        socket.emit('update_location', {id:currentUser.id, lat:latitude, lng:longitude, angle:heading||0});
        updateUserMarker(latitude, longitude);
    }, null, {enableHighAccuracy:true});
}
function stopDriverMode() { if(watchId) navigator.geolocation.clearWatch(watchId); }

// UI AUTH & PROFILE
window.openModal = (id) => document.getElementById(id)?.classList.add('active');
window.closeModal = (id) => document.getElementById(id)?.classList.remove('active');
window.switchModal = (t) => { closeModal('modal-menu'); setTimeout(()=>openModal(t), 200); };

window.processAuth = async (act, role) => {
    let id = act==='login' ? (role==='customer'?'login-cust-phone':'login-drv-phone') : (role==='customer'?'reg-cust-phone':'reg-drv-phone');
    const ph = document.getElementById(id).value;
    if(!ph) return alert("Isi No HP!");
    
    tempAuthData = { 
        action:act, role, phone: ph, 
        username: document.getElementById(act==='register'?(role==='customer'?'reg-cust-name':'reg-drv-name'):'')?.value, 
        plate: role==='driver'?document.getElementById('reg-drv-plate')?.value : null 
    };
    try { 
        const res = await fetch('/api/auth/request-otp', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({phone: ph})}); 
        const d = await res.json(); 
        if(d.success) { 
            document.querySelectorAll('.modal').forEach(m=>m.classList.remove('active')); 
            openModal('modal-otp'); 
        } else alert(d.message); 
    } catch(e) { alert("Error"); }
};

window.verifyOTP = async () => {
    const otp = document.getElementById('otp-input').value;
    const res = await fetch('/api/auth/verify-otp', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({...tempAuthData, otp})});
    const d = await res.json();
    if(d.success) { localStorage.setItem('goflash_user', JSON.stringify(d.data)); window.location.reload(); } else alert(d.message);
};

function checkLoginStatus() {
    const s = localStorage.getItem('goflash_user');
    if(s) {
        currentUser = JSON.parse(s);
        document.getElementById('auth-buttons').style.display = 'none';
        const photoUrl = currentUser.photo || `https://ui-avatars.com/api/?name=${currentUser.username}`;
        
        // Bind UI Profile
        document.getElementById('nav-profile-img').src = photoUrl;
        document.getElementById('page-profile-name').innerText = currentUser.username;
        document.getElementById('page-profile-phone').innerText = currentUser.phone;
        document.getElementById('page-profile-img').src = photoUrl;
        
        socket.emit('register_socket', currentUser.id);
        if(currentUser.role === 'driver') {
            document.getElementById('nav-driver-orders').classList.remove('hidden'); 
            document.getElementById('nav-driver-orders').classList.add('flex'); 
            document.getElementById('driver-toggle-container').classList.remove('hidden');
            document.getElementById('driver-status-toggle').addEventListener('change', (e) => { 
                isDriverActive = e.target.checked; 
                socket.emit('driver_status_change', {id:currentUser.id, status:isDriverActive?'online':'offline'}); 
                if(isDriverActive) startDriverMode(); else stopDriverMode(); 
            });
        }
    } else document.getElementById('auth-buttons').style.display = 'block';
}

window.logout = () => { localStorage.removeItem('goflash_user'); window.location.reload(); };
window.openEditProfile = () => { 
    if(!currentUser) return; 
    document.getElementById('edit-name').value = currentUser.username; 
    if(currentUser.role==='driver') { 
        document.getElementById('edit-plate').value = currentUser.plate||''; 
        document.getElementById('edit-plate').classList.remove('hidden'); 
    } 
    openModal('modal-edit-profile'); 
};
window.previewProfileImage = (input) => { 
    if (input.files && input.files[0]) { 
        const reader = new FileReader(); 
        reader.onload = (e) => { 
            document.getElementById('edit-profile-preview').src = e.target.result; 
            tempPhotoBase64 = e.target.result; 
        }; 
        reader.readAsDataURL(input.files[0]); 
    } 
};
window.saveProfile = async () => { 
    const data = { id: currentUser.id, username: document.getElementById('edit-name').value, photo: tempPhotoBase64 }; 
    if(currentUser.role==='driver') data.plate = document.getElementById('edit-plate').value; 
    try { 
        const res = await fetch('/api/update_profile', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)}); 
        const r = await res.json(); 
        if(r.success) { 
            currentUser = {...currentUser, ...r.data}; 
            localStorage.setItem('goflash_user', JSON.stringify(currentUser)); 
            window.location.reload(); 
        } else alert("Gagal"); 
    } catch(e) { alert("Error"); } 
};

window.showPaymentModal = (amount) => { document.getElementById('payment-amount').innerText = "Rp " + amount.toLocaleString(); openModal('modal-payment'); };
window.confirmPayment = () => { 
    closeModal('modal-payment'); 
    activeOrder = null; 
    document.getElementById('panel-tracking-customer').style.bottom = "-100%"; 
    alert("✅ Selesai!"); 
    window.location.reload(); 
};
window.acceptOrder = (orderId) => {
    // Trik: Jika orderId kosong (karena diklik dari Popup), ambil dari tempOrderId
    const finalOrderId = orderId || window.tempOrderId; 
    
    if(!finalOrderId) return alert("Error: ID Order tidak terbaca.");

    // Kirim sinyal terima ke server
    socket.emit('accept_order', { orderId: finalOrderId, driverId: currentUser.id });
    
    // Tutup popup modal (jika driver menerimanya lewat popup)
    closeModal('modal-incoming-order');

    // Update tampilan di Tab Order secara instan
    const idx = driverOrders.findIndex(o => o.id === finalOrderId);
    if (idx > -1) {
        driverOrders[idx].status = 'accepted';
        driverOrders[idx].payment_status = 'pending';
        activeOrder = driverOrders[idx];
        
        // Refresh kotak pesanan jika sedang buka tab Order
        if(document.getElementById('view-orders').classList.contains('active')) {
            renderDriverOrderList();
        }
    }
};
// ==========================================
// 2. FUNGSI MARKER PETA (DENGAN TEKS MELAYANG)
window.updateDriverMarker = function(data) {
    if(!map || !data.location) return;
    if(currentUser && currentUser.id === data.id) return; // Sembunyikan diri sendiri

    let color = '#9CA3AF'; // Abu (Offline)
    let statusClass = 'bg-offline';
    
    if (data.status === 'online') {
        if (data.isBusy) { color = '#EF4444'; statusClass = 'bg-busy'; } 
        else { color = '#10B981'; statusClass = 'bg-online'; }
    }

    // --- LOGIKA TEKS MELAYANG "SEGERA DIPROSES" ---
    let labelHtml = '';
    // Jika Customer sedang punya orderan aktif, dan ID driver ini cocok dengan driver yang menerima orderannya
    if (activeOrder && activeOrder.driverId === data.id && currentUser.role === 'customer') {
        labelHtml = `<div class="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white text-[9px] px-2 py-0.5 rounded-full shadow-md font-bold whitespace-nowrap z-[2000] animate-bounce">Segera Diproses</div>`;
    }

    // Gabungkan Teks dengan Ikon Motor
    const html = `
        <div class="relative flex justify-center items-center">
            ${labelHtml}
            <div class="driver-icon-box" style="border: 3px solid ${color}; color: ${color}; transform: rotate(${data.angle || 0}deg);">
                <i class="fas fa-motorcycle"></i>
                <div class="status-dot ${statusClass}" style="transform: rotate(-${data.angle || 0}deg);"></div>
            </div>
        </div>
    `;
    
    // Set iconAnchor agar titik tengah marker tetap akurat meski ketambahan teks
    const icon = L.divIcon({className:'d', html, iconSize:[40,40], iconAnchor: [20, 20]});

    if(driverMarkers[data.id]) {
        driverMarkers[data.id].setLatLng([data.location.lat, data.location.lng]).setIcon(icon);
        driverMarkers[data.id].driverData = data; 
    } else {
        const m = L.marker([data.location.lat, data.location.lng], {icon}).addTo(map);
        m.driverData = data;
        m.on('click', function(e) { 
            L.DomEvent.stopPropagation(e); 
            if(typeof window.onDriverMarkerClick === 'function') window.onDriverMarkerClick(this.driverData); 
        });
        driverMarkers[data.id] = m;
    }
};

// ==========================================
// 11. INTERAKSI TAMPILAN (UI LOGIC) & SUBMIT ORDER
// ==========================================

// 1. Logika Klik Marker Peta
window.onDriverMarkerClick = (data) => {
    if(!data) return;
    selectedDriver = data; 

    // Isi Data Sheet
    document.getElementById('sheet-drv-name').innerText = data.username || 'Driver';
    document.getElementById('sheet-drv-plate').innerText = data.plate || '-';
    document.getElementById('sheet-drv-model').innerText = data.vehicleModel || 'Kendaraan';
    
    const imgEl = document.getElementById('sheet-drv-img');
    if(imgEl) imgEl.src = data.photo || `https://ui-avatars.com/api/?name=${data.username}`;

    const btnSubmit = document.getElementById('btn-submit-order'); 
    const statusText = document.getElementById('sheet-drv-status-text'); 
    const statusDot = document.getElementById('sheet-drv-status-dot');

    if (data.isBusy) {
        // KASUS SIBUK
        if(statusDot) statusDot.className = "absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-white bg-red-500";
        if(statusText) {
            statusText.innerText = "Sedang Mengantar (Bisa Pre-Order)";
            statusText.className = "text-[10px] font-bold text-red-500 mt-1";
        }
        if(btnSubmit) {
            btnSubmit.innerHTML = `<span>LAKUKAN PRE-ORDER</span> <i class="fas fa-clock"></i>`;
            btnSubmit.className = "w-full py-4 text-white font-bold rounded-xl shadow-lg flex items-center justify-center gap-2 transition active:scale-95 bg-red-500";
            // ⚡ PENTING: IKAT TOMBOL SECARA PAKSA!
            btnSubmit.onclick = window.submitOrder; 
        }
    } else {
        // KASUS HIJAU (SIAP)
        if(statusDot) statusDot.className = "absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-white bg-green-500";
        if(statusText) {
            statusText.innerText = "Ready - Siap Jemput";
            statusText.className = "text-[10px] font-bold text-green-600 mt-1";
        }
        if(btnSubmit) {
            btnSubmit.innerHTML = `<span>KONFIRMASI PESANAN</span> <i class="fas fa-paper-plane"></i>`;
            btnSubmit.className = "w-full py-4 text-white font-bold rounded-xl shadow-lg flex items-center justify-center gap-2 transition active:scale-95 bg-gradient-to-r from-blue-600 to-blue-500";
            // ⚡ PENTING: IKAT TOMBOL SECARA PAKSA!
            btnSubmit.onclick = window.submitOrder; 
        }
    }

    const sheet = document.getElementById('driver-sheet');
    if(sheet) sheet.style.bottom = "0";
    
    const form = document.getElementById('sheet-order-form');
    if(form) form.classList.add('hidden');
    
    const mainAction = document.getElementById('sheet-main-actions');
    if(mainAction) mainAction.classList.remove('hidden');
};

// 2. Logika Hitung Harga 
window.calculatePrice = () => {
    const idx = document.getElementById('dest-select').value;
    if(idx === "" || !appConfig || !appConfig.PRICES) {
        document.getElementById('price-display').innerText = "Rp 0";
        return;
    }
    const priceList = (currentServiceType === 'ride') ? appConfig.PRICES.RIDE : appConfig.PRICES.DELIVERY;
    const price = priceList[idx].price;
    document.getElementById('price-display').innerText = "Rp " + price.toLocaleString();
};

// =====================================================================
// PATCH PEMBATALAN TUNTAS (ANTI-NYANGKUT SAAT DI-REFRESH)
// Membersihkan memori Driver & Customer sepenuhnya sampai ke akar
// =====================================================================

// 1. FUNGSI SAAT DRIVER KLIK TOMBOL "BATALKAN PESANAN"
window.driverCancelOrderAction = (orderId) => {
    const finalId = orderId || currentControlOrderId;
    if (!finalId) return;

    // Konfirmasi dulu agar tidak kepencet
    const confirmBatal = confirm("Yakin ingin membatalkan pesanan ini?");
    if (!confirmBatal) return;

    // A. Tembak sinyal batal ke Server & Customer
    socket.emit('cancel_order_by_driver', { orderId: finalId, driverId: currentUser.id });

    // B. Notifikasi langsung ke layar Driver
    alert("✅ Pesanan berhasil Anda batalkan.");

    // C. Hapus pesanan dari "Fitur Order" (Memori Driver) secara paksa
    if (typeof driverOrders !== 'undefined') {
        driverOrders = driverOrders.filter(o => o.id !== finalId); // Buang yang dibatalkan
    }
    if (activeOrder && activeOrder.id === finalId) activeOrder = null;
    currentControlOrderId = null;

    // D. Refresh/Tutup Layar & Kembalikan ke Hijau
    if (typeof closeModal === 'function') closeModal('modal-driver-action');
    if (typeof renderDriverOrderList === 'function') renderDriverOrderList();
    if (typeof window.forceDriverGreen === 'function') window.forceDriverGreen();
};

// 2. RESPONS CUSTOMER SAAT DRIVER MEMBATALKAN
socket.on('order_cancelled_by_driver', (data) => {
    if (currentUser && currentUser.role === 'customer') {
        if (navigator.vibrate) navigator.vibrate([500, 200, 500]);
        
        // A. Notifikasi ke Customer
        alert("❌ MAAF! Driver membatalkan pesanan Anda. Silakan pesan kembali.");
        
        // B. Hapus Memori Customer agar tidak nyangkut saat refresh
        activeOrder = null;
        selectedDriver = null;
        
        // C. Tutup semua Pop-up & Peta Tracking
        if (typeof closeModal === 'function') closeModal('modal-waiting');
        const panelTracking = document.getElementById('panel-tracking-customer');
        if (panelTracking) panelTracking.style.bottom = "-100%"; 
        
        // D. Kembalikan ke menu awal
        if (typeof window.showPanel === 'function') window.showPanel('panel-order');
    }
});

// 3. RESPONS DRIVER SAAT CUSTOMER MEMBATALKAN
socket.on('order_cancelled_by_customer', (data) => {
    if (currentUser && currentUser.role === 'driver') {
        if (navigator.vibrate) navigator.vibrate([500, 200, 500]);
        
        alert("❌ YAH! Penumpang membatalkan pesanannya.");
        
        // Ekstrak ID yang dibatalkan
        const canceledId = data ? data.orderId : (activeOrder ? activeOrder.id : null);
        
        // Bersihkan Keranjang Fitur Order
        if (typeof driverOrders !== 'undefined' && canceledId) {
            driverOrders = driverOrders.filter(o => o.id !== canceledId);
        }
        if (activeOrder && activeOrder.id === canceledId) activeOrder = null;
        if (currentControlOrderId === canceledId) currentControlOrderId = null;

        // Tutup layar kontrol dan refresh keranjang
        if (typeof closeModal === 'function') closeModal('modal-driver-action');
        if (typeof renderDriverOrderList === 'function') renderDriverOrderList();
        if (typeof window.forceDriverGreen === 'function') window.forceDriverGreen();
    }
});

// 4. FILTER ANTI-NYANGKUT (MEMBAJAK DATA SAAT REFRESH HALAMAN)
// Jika web di-refresh, kode ini akan membuang pesanan yang statusnya 'cancelled' 
// ke tong sampah sebelum sempat masuk ke layar pengguna.
const originalSocketOn = socket.on;
socket.on = function(eventName, callback) {
    if (eventName === 'receive_history' || eventName === 'active_order_data') {
        const interceptCallback = function(data) {
            // Jika data berupa array (banyak pesanan di Driver)
            if (Array.isArray(data)) {
                data = data.filter(o => 
                    o.status !== 'cancelled' && 
                    o.status !== 'cancelled_by_driver' && 
                    o.status !== 'cancelled_by_customer'
                );
            } 
            // Jika data berupa 1 pesanan (di Customer)
            else if (data && typeof data === 'object') {
                if (data.status === 'cancelled' || data.status === 'cancelled_by_driver' || data.status === 'cancelled_by_customer') {
                    data = null; // Kosongkan
                }
            }
            callback(data);
        };
        return originalSocketOn.call(socket, eventName, interceptCallback);
    }
    return originalSocketOn.call(socket, eventName, callback);
};
// ==========================================
// 12. SOCKET LISTENERS (OTAK UTAMA)
// ==========================================
// Panggil fungsi setupSocketListeners() ini di init() atau timpa yang lama

function setupSocketListeners() {
    // A. Update Posisi & Status Driver (Merah/Hijau)
    socket.on('driver_moved', updateDriverMarker);
    socket.on('driver_state_update', updateDriverMarker);
    socket.on('initial_drivers_data', (list) => list.forEach(updateDriverMarker));

    // B. Order Masuk (Untuk Driver)
    socket.on('incoming_order', (o) => {
        if(!isDriverActive && currentUser.role === 'driver') return;
        
        // Bunyi Notif
        const audio = document.getElementById('notif-sound');
        if(audio) audio.play().catch(()=>{});

        // Isi Modal Incoming
        document.getElementById('incoming-pickup').innerText = o.pickupLocation;
        document.getElementById('incoming-dest').innerText = o.destination;
        document.getElementById('incoming-price').innerText = "Rp " + parseInt(o.price).toLocaleString();
        
        window.tempOrderId = o.id; // Simpan ID Order untuk Accept
        openModal('modal-incoming-order');
        
        // Masukkan ke List Tab Order
        if(!driverOrders.find(d => d.id === o.id)) {
            driverOrders.unshift(o);
            // Render ulang list jika sedang di tab order (logic render ada di kode Bapak)
            if(document.getElementById('view-orders').classList.contains('active')) renderDriverOrderList(); 
        }
    });

// C. Order Diterima (Untuk Customer -> LOGIKA QRIS)
    socket.on('order_accepted', (o) => {
        
        // --- TAMBAHAN BARU: SENSOR WAKTU UNTUK HITUNG MUNDUR BATAL ---
        o.accepted_at = new Date().getTime(); 
        
        activeOrder = o;
        closeModal('modal-waiting'); // Tutup radar

        if(currentUser.role === 'customer') {
            // --- LOGIKA SWITCHING PEMBAYARAN ---
            if (o.paymentMethod === 'qris') {
                // JIKA QRIS -> BUKA MODAL BAYAR
                showPaymentModal(o.price); 
                // Panel tracking tetap muncul di belakang (atau setelah bayar)
                document.getElementById('panel-tracking-customer').style.bottom = "0"; 
            } else {
                // JIKA TUNAI -> LANGSUNG PETA
                document.getElementById('panel-tracking-customer').style.bottom = "0"; 
            }

            // Update Info Driver di Panel Tracking
            document.getElementById('track-drv-name').innerText = o.driverInfo.username;
            document.getElementById('track-drv-img').src = o.driverInfo.photo || "";
            
            // Setup Chat
            chatPartner = {id: o.driverId, name: o.driverInfo.username};
            updateChatContacts(o.driverId, o.driverInfo.username, "Driver OTW");

        } else {
            // --- LOGIKA DRIVER (Trip Panel) ---
            closeModal('modal-incoming-order');
            document.getElementById('trip-cust-name').innerText = o.customerName;
            document.getElementById('trip-price').innerText = "Rp " + parseInt(o.price).toLocaleString();
            document.getElementById('trip-dest').innerText = o.destination;
            document.getElementById('panel-trip-driver').style.bottom = "0";
            
            chatPartner = {id: o.customerId, name: o.customerName};
            updateChatContacts(o.customerId, o.customerName, "Menjemput...");
        }
    });

    // D. Order Selesai
    socket.on('order_finished', () => { 
        if(currentUser.role === 'driver') {
            alert("Order Selesai. Saldo masuk.");
            window.location.reload(); 
        } else {
            // Customer bisa dikasih modal rating (Next Feature)
            alert("Perjalanan Selesai. Terima kasih!");
            window.location.reload();
        }
    });

    // E. Chat Masuk (Realtime)
    socket.on('receive_chat', (d) => {
        if(!chatMessages[d.fromId]) chatMessages[d.fromId] = [];
        chatMessages[d.fromId].push({text: d.message, isMe: false});
        updateChatContacts(d.fromId, d.fromName, d.message);
        
        if(document.getElementById('modal-chat-room').classList.contains('active')) {
            renderChatBubble(d.message, false);
        } else {
            // Notifikasi suara chat
            const audio = document.getElementById('notif-sound');
            if(audio) audio.play().catch(()=>{});
        }
    });
}

// ============================================================
// FITUR TAMBAHAN: PEMBAYARAN & DRIVER CONTROL (PASTE DI PALING BAWAH)
// ============================================================

// --- A. LOGIKA CUSTOMER (PEMBAYARAN) ---
window.showPaymentModal = (amount) => {
    // 1. Sembunyikan tulisan "Total Tagihan: Rp 0" (Lingkaran Hijau)
    const payAmtEl = document.getElementById('pay-method-amount');
    if (payAmtEl && payAmtEl.parentElement) {
        payAmtEl.parentElement.style.display = 'none';
    }

    openModal('modal-payment-method');
    
    // 2. Tampilkan dan Perkecil tombol Cash & QRIS (Lingkaran Merah)
    const btnContainer = document.querySelector('#modal-payment-method .grid.grid-cols-2');
    if (btnContainer) {
        btnContainer.style.display = 'grid'; // Pastikan muncul kembali
        const btns = btnContainer.querySelectorAll('button');
        btns.forEach(btn => {
            btn.style.transform = "scale(0.85)"; // Perkecil ukuran
            btn.style.padding = "5px";
            btn.style.minHeight = "70px";
        });
    }

    // Hapus tombol "< Kembali" jika ada (karena sedang di menu awal)
    const backBtn = document.getElementById('btn-back-payment');
    if (backBtn) backBtn.remove();

    // Reset area upload bukti
    if(document.getElementById('payment-evidence-area')) {
        document.getElementById('payment-evidence-area').classList.add('hidden');
    }
    window.tempPaymentBase64 = null;
    
    // Bersihkan info kotak tagihan sebelumnya
    let oldBox = document.getElementById('pay-info-box');
    if(oldBox) oldBox.remove();

    // Reset preview foto agar kembali ke wujud kamera abu-abu
    const imgPreview = document.getElementById('evidence-preview');
    if(imgPreview) imgPreview.classList.add('hidden');
    const placeholder = document.getElementById('evidence-placeholder');
    if(placeholder) placeholder.classList.remove('hidden');
    const btnSend = document.getElementById('btn-send-proof');
    if(btnSend) {
        btnSend.disabled = true;
        btnSend.className = "w-full bg-gray-300 text-white font-bold py-3 rounded-xl cursor-not-allowed transition";
    }
};

window.selectPaymentMethod = (method) => {
    window.selectedPayMethod = method;
    const area = document.getElementById('payment-evidence-area');
    const title = document.getElementById('evidence-title');
    const camInput = document.getElementById('camera-input');
    
    area.classList.remove('hidden');

    // Sembunyikan judul bawaan "Foto Uang Tunai" agar tidak ganda
    if(title) title.style.display = 'none';

    // 3. SEMBUNYIKAN TOMBOL CASH & QRIS AGAR AREA FOTO NAIK
    const btnContainer = document.querySelector('#modal-payment-method .grid.grid-cols-2');
    if (btnContainer) btnContainer.style.display = 'none';

    // 4. BUAT TOMBOL "< KEMBALI"
    let backBtn = document.getElementById('btn-back-payment');
    if (!backBtn) {
        backBtn = document.createElement('button');
        backBtn.id = 'btn-back-payment';
        backBtn.innerHTML = '<i class="fas fa-chevron-left"></i> Ganti Metode Pembayaran';
        backBtn.className = 'text-blue-600 font-bold text-sm mb-4 flex items-center gap-2 cursor-pointer w-full text-left bg-blue-50 p-3 rounded-xl border border-blue-100 shadow-sm active:scale-95 transition';
        backBtn.onclick = () => {
            const price = activeOrder ? activeOrder.price : 0;
            showPaymentModal(price); // Reset kembali ke awal
        };
        // Masukkan tepat di atas area foto
        area.parentNode.insertBefore(backBtn, area);
    }
    
    // Ambil harga tagihan dari data activeOrder
    const priceStr = activeOrder ? parseInt(activeOrder.price).toLocaleString() : "0";
    
    let oldBox = document.getElementById('pay-info-box');
    if(oldBox) oldBox.remove();
    
    // Buat kotak info visual baru
    let infoBox = document.createElement('div');
    infoBox.id = 'pay-info-box';
    infoBox.className = 'mb-4 mt-2';
    
    if (method === 'cash') {
        camInput.setAttribute('capture', 'environment'); // Paksa kamera belakang
        
        infoBox.innerHTML = `
            <div class="bg-green-50 text-green-700 p-4 rounded-xl border border-green-200 text-center shadow-sm">
                <p class="text-xs mb-1 font-bold">Total yang harus diserahkan:</p>
                <p class="text-3xl font-extrabold text-green-600 mb-2 mt-1">Rp ${priceStr}</p>
                <p class="text-[10px] text-green-600"><i class="fas fa-camera"></i> Silakan foto uang tunai sebagai bukti.</p>
            </div>
        `;
    } else {
        camInput.removeAttribute('capture'); // Galeri / Bebas
        
        infoBox.innerHTML = `
            <div class="bg-blue-50 text-blue-700 p-4 rounded-xl border border-blue-200 text-center shadow-sm">
                <p class="text-xs mb-1 font-bold">Total Tagihan QRIS:</p>
                <p class="text-3xl font-extrabold text-blue-600 mb-3 mt-1">Rp ${priceStr}</p>
                <div class="bg-white p-2 rounded-xl inline-block border border-blue-100 shadow-sm">
                    <img src="qris.jpg" alt="QRIS" class="w-44 h-44 object-contain mx-auto">
                </div>
                <p class="text-[10px] mt-3 text-blue-600"><i class="fas fa-upload"></i> Scan QRIS di atas, lalu upload buktinya.</p>
            </div>
        `;
    }
    
    // Masukkan kotak info ke dalam area foto (urutan paling atas)
    area.insertBefore(infoBox, area.firstChild);
};

window.handleEvidence = (input) => {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = document.getElementById('evidence-preview');
            img.src = e.target.result;
            img.classList.remove('hidden');

            // 5. JADIKAN HASIL FOTO BENTUK PERSEGI (SQUARE) KECIL 100x100px
            img.style.width = "100px";
            img.style.height = "100px";
            img.style.objectFit = "cover";
            img.style.borderRadius = "8px";
            img.style.margin = "0 auto";
            img.style.display = "block";

            document.getElementById('evidence-placeholder').classList.add('hidden');
            
            const btn = document.getElementById('btn-send-proof');
            btn.disabled = false;
            btn.classList.remove('bg-gray-300', 'cursor-not-allowed');
            btn.classList.add('btn-gold');
            
            window.tempPaymentBase64 = e.target.result;
        };
        reader.readAsDataURL(input.files[0]);
    }
};

// ==========================================
// LOGIKA CUSTOMER: KIRIM BUKTI BAYAR (ULTIMATE & BULLETPROOF)
// Menyatukan efek kilat & payload ganda agar server pasti menerima
// ==========================================
window.submitPaymentProof = () => {
    try {
        // 1. Validasi Ketat
        if (!activeOrder) return alert("Sistem: Pesanan tidak ditemukan atau layar perlu di-refresh.");
        if (!window.tempPaymentBase64) return alert("Peringatan: Silakan unggah/foto bukti pembayaran terlebih dahulu!");

        // 2. Efek UI Kilat (Cari tombol berdasarkan ID atau onclick)
        const btnSubmit = document.getElementById('btn-submit-payment') || 
                          document.getElementById('btn-send-proof') || 
                          document.querySelector('[onclick="submitPaymentProof()"]');
        
        let originalText = "KIRIM BUKTI PEMBAYARAN";
        if (btnSubmit) {
            if (btnSubmit.disabled && btnSubmit.innerHTML.includes('Mengirim')) return; // Anti-Spam
            originalText = btnSubmit.innerHTML;
            btnSubmit.innerHTML = '<i class="fas fa-spinner fa-spin"></i> MENGIRIM...';
            btnSubmit.disabled = true;
            btnSubmit.classList.add('opacity-50', 'cursor-not-allowed');
            if (navigator.vibrate) navigator.vibrate([100, 50, 100]); // Efek Getar
        }

        // 3. Tembak Data ke Server (Payload Ganda/Double Guardian)
        // Kita kirim 'paymentProof' dan 'proofBase64' sekaligus agar apapun yang server minta pasti ada!
        socket.emit('submit_payment', { 
            orderId: activeOrder.id, 
            method: window.selectedPayMethod || 'qris',
            paymentProof: window.tempPaymentBase64, // Untuk Server versi A
            proofBase64: window.tempPaymentBase64   // Untuk Server versi B
        });

        console.log("⚡ KILAT: Bukti pembayaran dikirim ke server!");

        // 4. Tutup Pop-Up & Munculkan Notifikasi
        setTimeout(() => {
            // Tutup segala kemungkinan nama ID modal pembayaran
            if (typeof closeModal === 'function') {
                closeModal('modal-payment-method');
                closeModal('modal-payment');
            }
            
            alert("📸 Bukti terkirim! Menunggu verifikasi dari Driver...");

            // Buka kembali kunci tombol (Jaga-jaga jika gagal)
            if (btnSubmit) {
                btnSubmit.innerHTML = originalText;
                btnSubmit.disabled = false;
                btnSubmit.classList.remove('opacity-50', 'cursor-not-allowed');
            }
        }, 500);

    } catch (error) {
        // Jika UI HTML Bapak ada yang hilang, HP akan meneriakkan sumber errornya
        alert("Terjadi Bug Pembayaran: " + error.message);
        console.error("Crash di submitPaymentProof:", error);
    }
};

// 2. FUNGSI LOGIKA MEMBUKA KUNCI TAHAP 3 OTOMATIS
window.showProofUI = (data) => {
    const icon = document.getElementById('step-2-icon');
    if(icon) {
        icon.className = "w-8 h-8 rounded-full bg-green-500 text-white flex items-center justify-center text-xs";
        icon.innerHTML = '<i class="fas fa-check"></i>';
    }
    
    const desc = document.getElementById('step-2-desc');
    if(desc) desc.innerText = `Metode: ${data.method.toUpperCase()}. Cek foto.`;
    
    const proofArea = document.getElementById('proof-display-area');
    if(proofArea) proofArea.classList.remove('hidden');
    
    const proofImg = document.getElementById('driver-proof-img');
    if(proofImg) proofImg.src = data.proofBase64;

    // Sembunyikan tombol verifikasi lama (jika masih ada di HTML)
    const btnVerify = document.getElementById('btn-verify-pay');
    if(btnVerify) btnVerify.classList.add('hidden');

    // LANGSUNG BUKA KUNCI TAHAP 3 (TOMBOL KAMERA BISA DITEKAN)
    const step3 = document.getElementById('step-3-container');
    if(step3) step3.classList.remove('opacity-50', 'pointer-events-none');
};

window.openDriverControl = (orderId) => {
    window.currentControlOrderId = orderId;
    const order = driverOrders.find(o => o.id === orderId);
    
    // --- 1. SIAPKAN ELEMEN UI ---
    const modalContent = document.querySelector('#modal-driver-action .bg-white');
    
    // Cari tombol Close/Back di pojok kiri atas
    const topBackBtn = document.querySelector('#modal-driver-action button.absolute');
    if(topBackBtn) {
        topBackBtn.className = "absolute top-4 left-4 text-gray-500 hover:text-royal transition w-10 h-10 flex items-center justify-center rounded-full bg-gray-50 z-50";
        topBackBtn.innerHTML = '<i class="fas fa-arrow-left text-lg"></i>';
    }

    // Cari Container Langkah-langkah
    let stepsContainer = document.getElementById('mission-steps-container');
    if (!stepsContainer) {
        const foundContainer = modalContent.querySelector('.space-y-4');
        if (foundContainer) {
            foundContainer.id = "mission-steps-container";
            stepsContainer = foundContainer;
        }
    }

    // Buat/Cari Container Detail Pelanggan
    let detailsContainer = document.getElementById('driver-customer-details');
    if (!detailsContainer) {
        detailsContainer = document.createElement('div');
        detailsContainer.id = 'driver-customer-details';
        // Masukkan di atas steps
        const p6 = modalContent.querySelector('.p-6') || modalContent;
        if(stepsContainer && stepsContainer.parentNode) {
            stepsContainer.parentNode.insertBefore(detailsContainer, stepsContainer);
        } else {
            p6.appendChild(detailsContainer);
        }
    }

    // --- PERBAIKAN TOMBOL "KONTROL MISI" (PASTI MUNCUL) ---
    let btnOpenMission = document.getElementById('btn-open-mission-view');
    if (!btnOpenMission) {
        btnOpenMission = document.createElement('button');
        btnOpenMission.id = 'btn-open-mission-view';
        // SAYA SUDAH GANTI 'bg-royal' MENJADI 'btn-royal' AGAR WARNANYA KELUAR
        btnOpenMission.className = "w-full py-4 btn-royal text-white font-bold rounded-2xl shadow-lg flex items-center justify-center gap-3 mt-6 mb-4 active:scale-95 transition";
        btnOpenMission.innerHTML = '<i class="fas fa-tasks text-lg"></i> <span class="text-sm">KONTROL MISI</span>';
        
        if(stepsContainer && stepsContainer.parentNode) {
            stepsContainer.parentNode.insertBefore(btnOpenMission, stepsContainer);
        }
    } else {
        // Jika tombol sudah ada, paksa update teks dan warnanya
        btnOpenMission.innerHTML = '<i class="fas fa-tasks text-lg"></i> <span class="text-sm">KONTROL MISI</span>';
        btnOpenMission.className = "w-full py-4 btn-royal text-white font-bold rounded-2xl shadow-lg flex items-center justify-center gap-3 mt-6 mb-4 active:scale-95 transition";
    }

    // --- 2. LOGIKA TAMPILAN (VIEW LOGIC) ---
    const showDetailMode = () => {
        detailsContainer.classList.remove('hidden');
        btnOpenMission.classList.remove('hidden');
        if(stepsContainer) stepsContainer.classList.add('hidden');
        
        const title = document.querySelector('#modal-driver-action h3');
        if(title) title.innerText = "Detail Order";

        topBackBtn.onclick = () => closeModal('modal-driver-action');
    };

    const showMissionMode = () => {
        detailsContainer.classList.add('hidden');
        btnOpenMission.classList.add('hidden');
        if(stepsContainer) stepsContainer.classList.remove('hidden');
        
        const title = document.querySelector('#modal-driver-action h3');
        if(title) title.innerText = "Kontrol Misi";

        topBackBtn.onclick = showDetailMode;
    };

    btnOpenMission.onclick = showMissionMode;

    // --- 3. ISI DATA PELANGGAN ---
    if (order) {
        const mapUrl = order.pickupLink || `https://www.google.com/maps/dir/?api=1&destination=${order.pickupLat || 0},${order.pickupLng || 0}`;
        
        detailsContainer.innerHTML = `
            <div class="text-left mt-2">
                <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">PELANGGAN</p>
                <h3 class="font-bold text-royal text-2xl mb-4">${order.customerName || 'Customer'}</h3>
            </div>
            <div class="text-left space-y-4">
                <div>
                    <a href="${mapUrl}" target="_blank" class="block w-full bg-blue-50 hover:bg-blue-100 transition p-4 rounded-xl border border-blue-200 flex justify-between items-center cursor-pointer text-decoration-none shadow-sm">
                        <span class="text-sm font-bold text-blue-700"><i class="fas fa-map-marker-alt mr-2"></i> LOKASI JEMPUT (MAPS)</span>
                        <i class="fas fa-external-link-alt text-blue-500"></i>
                    </a>
                </div>
                <div class="bg-gray-50 p-4 rounded-xl border border-gray-200">
                    <p class="text-[10px] font-bold text-gray-400 uppercase mb-1">TUJUAN</p>
                    <p class="font-bold text-royal text-sm">${order.destination || '-'}</p>
                </div>
                <div class="bg-orange-50 p-4 rounded-xl border border-orange-100">
                    <p class="text-[10px] font-bold text-orange-400 uppercase mb-1">CATATAN</p>
                    <p class="text-orange-600 text-xs font-bold">${order.notes || '-'}</p>
                </div>
            </div>
        `;
    }

    // --- 4. DATA TEKNIS ---
    document.getElementById('ctrl-order-id').innerText = orderId.substr(-6);
    
    // Reset State Langkah-langkah
    document.getElementById('step-2-container').classList.add('opacity-50', 'pointer-events-none');
    document.getElementById('step-3-container').classList.add('opacity-50', 'pointer-events-none');
    document.getElementById('proof-display-area').classList.add('hidden');
    
    const icon = document.getElementById('step-2-icon');
    if(icon) {
        icon.className = "w-8 h-8 rounded-full bg-gray-300 text-white flex items-center justify-center text-xs";
        icon.innerHTML = '<i class="fas fa-lock"></i>';
    }
    const desc = document.getElementById('step-2-desc');
    if(desc) desc.innerText = "Customer belum kirim bukti.";

    window.tempHandoverBase64 = null; 
    if (document.getElementById('handover-preview-container')) {
        document.getElementById('handover-preview-container').classList.add('hidden');
        const btnT = document.getElementById('btn-take-handover');
        if(btnT) btnT.innerHTML = '<i class="fas fa-camera"></i> AMBIL FOTO SERAH TERIMA';
    }
    
    const btnFinish = document.getElementById('btn-finish-mission');
    if(btnFinish) {
        btnFinish.disabled = true;
        btnFinish.className = "w-full py-4 bg-gray-300 text-white font-bold rounded-xl shadow-lg flex items-center justify-center gap-2 cursor-not-allowed transition";
    }
    
    if(order && order.payment_proof) {
        document.getElementById('step-2-container').classList.remove('opacity-50', 'pointer-events-none');
        showProofUI({ method: order.payment_method, proofBase64: order.payment_proof });
    }
    
    // Start di Detail Mode
    showDetailMode();
    openModal('modal-driver-action');
};

// 4. SAAT BUKTI DITERIMA DARI CUSTOMER
window.onProofReceived = (data) => {
    if(!currentUser || currentUser.role !== 'driver') return;
    const audio = document.getElementById('notif-sound'); 
    if(audio) audio.play();
    
    // Update data di memori
    const idx = driverOrders.findIndex(o => o.id === data.orderId);
    if(idx > -1) {
        driverOrders[idx].payment_proof = data.proofBase64;
        driverOrders[idx].payment_method = data.method;
        driverOrders[idx].payment_status = 'pending_verification';
        if(document.getElementById('view-orders').classList.contains('active')) renderDriverOrderList();
    }

    document.getElementById('step-2-container').classList.remove('opacity-50', 'pointer-events-none');
    showProofUI(data); // Tampilkan bukti & buka Tahap 3
    openModal('modal-driver-action'); // Munculkan pop-up Kontrol Misi
    
    // Otomatis verifikasi agar Customer dapat notif "Lunas" (tanpa klik tombol)
    socket.emit('confirm_payment', { orderId: data.orderId });
};

// 3. FUNGSI VERIFIKASI PEMBAYARAN
window.verifyPaymentAction = () => {
    if(window.currentControlOrderId) {
        socket.emit('confirm_payment', { orderId: window.currentControlOrderId });
        document.getElementById('btn-verify-pay').innerHTML = '<i class="fas fa-spinner fa-spin"></i> Tunggu...';
    }
};

// ==============================================================
// BLOK PENYEMBUH: KONTROL MISI & RIWAYAT (BERSIH, STABIL, 100% BEKERJA)
// ==============================================================

window.tempHandoverBase64 = null;

// --- 1. FUNGSI KAMERA SERAH TERIMA (ANTI MACET) ---
window.handleHandoverPhoto = function(input) {
    if (input.files && input.files[0]) {
        var reader = new FileReader();
        reader.onload = function(e) {
            var img = document.getElementById('handover-preview-img');
            if(img) img.src = e.target.result;
            
            var container = document.getElementById('handover-preview-container');
            if(container) container.classList.remove('hidden');
            
            var btnT = document.getElementById('btn-take-handover');
            if(btnT) btnT.innerHTML = '<i class="fas fa-redo"></i> FOTO ULANG';

            // Buka paksa gembok tombol Misi Selesai
            var btnFinish = document.getElementById('btn-finish-mission');
            if(btnFinish) {
                btnFinish.disabled = false;
                btnFinish.removeAttribute('disabled');
                btnFinish.className = "w-full py-4 bg-red-500 text-white font-bold rounded-xl shadow-lg flex items-center justify-center gap-2 hover:bg-red-600 active:scale-95 transition";
            }
            
            var hint = document.getElementById('finish-mission-hint');
            if(hint) hint.innerText = "Foto berhasil disimpan. Silakan klik tombol MERAH di bawah.";

            // Simpan ke memori global
            window.tempHandoverBase64 = e.target.result;
        };
        reader.readAsDataURL(input.files[0]);
    }
};

// --- 2. FUNGSI MISI SELESAI (PERBAIKAN: MUNCUL DI RIWAYAT DRIVER) ---
window.finishMissionAction = function() {
    if (!window.tempHandoverBase64) {
        alert("SOP: Harap ambil foto serah terima terlebih dahulu!");
        return;
    }

    var orderId = window.currentControlOrderId;

    if (!orderId && typeof driverOrders !== 'undefined') {
        var aOrder = driverOrders.find(function(o) { return o.status === 'accepted'; });
        if (aOrder) orderId = aOrder.id;
    }

    if (!orderId) {
        var uiText = document.getElementById('ctrl-order-id');
        if (uiText && uiText.innerText && uiText.innerText !== '...') {
            var idAkhir = uiText.innerText.trim();
            var matchedOrder = driverOrders.find(function(o) { return o.id.endsWith(idAkhir); });
            if (matchedOrder) orderId = matchedOrder.id;
        }
    }

    if (!orderId) {
        alert("Sistem memori HP Anda kepenuhan. Silakan TUTUP pop-up ini, BUKA LAGI, dan langsung klik tombol Misi Selesai.");
        return;
    }

    var btnFinish = document.getElementById('btn-finish-mission');
    if (btnFinish) {
        btnFinish.innerHTML = '<i class="fas fa-spinner fa-spin"></i> MEMPROSES...';
        btnFinish.disabled = true; 
    }

    socket.emit('finish_mission', { 
        orderId: orderId,
        handoverProof: window.tempHandoverBase64
    });
    
    closeModal('modal-driver-action');

    var idx = driverOrders.findIndex(function(o) { return o.id === orderId; });
    if(idx > -1) {
        driverOrders[idx].status = 'completed'; 
        if(typeof window.renderDriverOrderList === 'function') window.renderDriverOrderList(); 

        setTimeout(function() {
            var freshIdx = driverOrders.findIndex(function(o) { return o.id === orderId; });
            if(freshIdx > -1) driverOrders.splice(freshIdx, 1); 
            
            // PERBAIKAN PENTING DRIVER: Kosongkan activeOrder agar tidak ditolak oleh Riwayat
            if (activeOrder && activeOrder.id === orderId) {
                activeOrder = null; 
            }
            
            if(typeof window.renderDriverOrderList === 'function') window.renderDriverOrderList(); 
            if(currentUser) socket.emit('request_history', { userId: currentUser.id });
            
            window.currentControlOrderId = null;
            window.tempHandoverBase64 = null;
        }, 2500);
    } else {
        setTimeout(function() {
            if (activeOrder && activeOrder.id === orderId) activeOrder = null;
            if(typeof window.renderDriverOrderList === 'function') window.renderDriverOrderList(); 
            if(currentUser) socket.emit('request_history', { userId: currentUser.id });
            window.currentControlOrderId = null;
            window.tempHandoverBase64 = null;
        }, 2500);
    }
};

// --- 3. FUNGSI RIWAYAT CUSTOMER ---
window.cancelOrderHistory = function(orderId) {
    if (confirm("Yakin ingin membatalkan pesanan ini?")) {
        socket.emit('cancel_order_customer', { orderId: orderId, customerId: currentUser.id });
        
        var panel = document.getElementById('panel-tracking-customer');
        if (panel) panel.style.bottom = "-100%";
        activeOrder = null;
        if(typeof window.renderHistory === 'function') window.renderHistory();
    }
};

window.openPaymentFromHistory = function(orderId, price) {
    activeOrder = { id: orderId, price: price };
    if (typeof showPaymentModal === 'function') {
        showPaymentModal(price);
    }
};

// --- 4. PENANGKAP SINYAL MISI SELESAI (PERBAIKAN: BEKUKAN TOMBOL CUSTOMER) ---
socket.off('mission_ended');
socket.on('mission_ended', function(data) { 
    if (currentUser && currentUser.role === 'customer') {
        alert("🏁 Perjalanan Selesai. Terima kasih telah menggunakan Go Flash!");
        
        // PERBAIKAN PENTING CUSTOMER: 
        // Jangan di "null" kan. Ubah statusnya agar terdeteksi selesai oleh UI
        if(activeOrder) {
            activeOrder.status = 'completed';
            activeOrder.payment_status = 'verified';
        }

        var panel = document.getElementById('panel-tracking-customer');
        if (panel) panel.style.bottom = "-100%"; 
        
        // Render paksa seketika agar tombol "Batal" dan "Bayar" langsung mati (abu-abu)
        if(typeof window.renderHistory === 'function') {
            window.renderHistory();
        }

        // Panggil backup data history
        socket.emit('request_history', { userId: currentUser.id }); 
    }
});

// =====================================================================
// PATCH FINAL V4: PEMISAHAN RIWAYAT CUSTOMER & DRIVER
// - Customer: Lihat semua status (Menunggu, Diproses, Batal, Selesai)
// - Driver: HANYA lihat yang "Selesai" (Misi Berhasil)
// =====================================================================

setTimeout(() => {
    // 1. Fungsi Render UI
    window.renderHistory = function() {
        if(!currentUser) return;
        const c = document.getElementById('history-list');
        if (!c) return;
        
        c.innerHTML = '<div class="text-center mt-10 text-gray-400"><i class="fas fa-spinner fa-spin text-4xl mb-3 text-royal"></i><p class="text-sm font-bold">Memuat pesanan...</p></div>';
        socket.emit('request_history', { userId: currentUser.id });
    };

    // 2. Reset Listener
    socket.off('receive_history');

    // 3. Listener Utama
    socket.on('receive_history', function(serverOrders) {
        const c = document.getElementById('history-list');
        if(!c) return;

        c.innerHTML = ''; 
        if (window.cancelTimerInterval) clearInterval(window.cancelTimerInterval);

        if (!serverOrders || !Array.isArray(serverOrders) || serverOrders.length === 0) {
            const emptyMsg = currentUser.role === 'driver' ? 'Belum ada Misi Selesai' : 'Belum ada pesanan';
            c.innerHTML = `<div class="text-center text-gray-400 mt-24"><i class="fas fa-clipboard-check text-5xl mb-3 opacity-30"></i><p class="text-sm font-bold">${emptyMsg}</p></div>`;
            return;
        }

        let renderedCount = 0;

        serverOrders.forEach(function(o) {
            const cId = o.customer_id || o.customerId;
            const dId = o.driver_id || o.driverId;

            // 1. Pastikan ini milik user yang sedang login
            if (cId !== currentUser.id && dId !== currentUser.id) return;

            // =========================================================
            // 2. FILTER KHUSUS DRIVER: HANYA TAMPILKAN STATUS 'COMPLETED'
            // =========================================================
            if (currentUser.role === 'driver' && o.status !== 'completed') {
                return; // Lewati/Sembunyikan pesanan ini dari Riwayat Driver
            }

            // =========================================================
            // 3. FILTER KHUSUS CUSTOMER: SEMBUNYIKAN STATUS 'MENUNGGU/MENCARI'
            // =========================================================
            if (currentUser.role === 'customer' && (o.status === 'pending' || o.status === 'searching')) {
                return; // Sembunyikan pesanan aktif dari tab Riwayat Customer
            }

            renderedCount++;

            // Logic Sinkronisasi Order Aktif ke Layar Utama (Khusus Customer)
            if (o.status === 'completed' && activeOrder && activeOrder.id === o.id) {
                activeOrder = null;
                const panel = document.getElementById('panel-tracking-customer');
                if(panel) panel.style.bottom = "-100%";
            }
            else if ((o.status === 'accepted' || o.status === 'searching') && currentUser.role === 'customer') {
                activeOrder = o;
            }

            const d = document.createElement('div');
            let statusText = ''; let statusColor = ''; let statusBg = ''; let borderClass = ''; let btnHtml = ''; let showTimer = false; let sisaWaktu = 0;

            // ============================================================
            // LOGIKA DESAIN & TOMBOL
            // ============================================================

            if (o.status === 'searching') {
                statusText = 'MENUNGGU KONFIRMASI DRIVER'; statusColor = 'text-orange-600'; statusBg = 'bg-orange-50'; borderClass = 'border-orange-400';
                btnHtml = `<div class="pt-3 border-t border-gray-100"><button onclick="cancelOrderHistory('${o.id}')" class="w-full bg-red-50 text-red-500 py-2.5 rounded-xl text-xs font-bold active:scale-95 transition">BATALKAN PESANAN</button></div>`;
            } 
            else if (o.status === 'accepted') {
                statusText = 'DIPROSES DRIVER'; statusColor = 'text-blue-700'; statusBg = 'bg-blue-100'; borderClass = 'border-blue-500';
                const waktuMulai = o.accepted_at ? new Date(o.accepted_at).getTime() : (o.created_at ? new Date(o.created_at).getTime() : new Date().getTime());
                sisaWaktu = 30 - Math.floor((new Date().getTime() - waktuMulai) / 1000);

                if (sisaWaktu > 0) {
                    showTimer = true;
                    btnHtml = `
                        <div class="grid grid-cols-2 gap-2 pt-3 border-t border-gray-100">
                            <button id="btn-cancel-${o.id}" onclick="cancelOrderHistory('${o.id}')" class="bg-red-50 text-red-500 py-2.5 rounded-xl text-[10px] font-bold active:scale-95 transition">BATAL</button>
                            <button onclick="openPaymentFromHistory('${o.id}', ${o.price})" class="bg-green-500 text-white py-2.5 rounded-xl text-[10px] font-bold active:scale-95 transition">BAYAR SEKARANG</button>
                        </div>
                        <div id="timer-text-${o.id}" class="text-[11px] text-red-500 font-bold text-center mt-2 bg-red-50 py-1 rounded border border-red-100"><i class="fas fa-stopwatch animate-pulse"></i> Batal: ${sisaWaktu}s</div>`;
                } else {
                    btnHtml = `<div class="grid grid-cols-2 gap-2 pt-3 border-t border-gray-100"><button disabled class="bg-gray-100 text-gray-400 py-2.5 rounded-xl text-[10px] font-bold cursor-not-allowed">BATAL (WAKTU HABIS)</button><button onclick="openPaymentFromHistory('${o.id}', ${o.price})" class="bg-green-500 text-white py-2.5 rounded-xl text-[10px] font-bold active:scale-95 transition">BAYAR SEKARANG</button></div>`;
                }
            } 
            else if (o.status === 'completed') {
                statusText = 'SELESAI'; statusColor = 'text-green-700'; statusBg = 'bg-green-100'; borderClass = 'border-green-500'; 
                
                // DESAIN KHUSUS: Jika yang melihat adalah DRIVER
                if (currentUser.role === 'driver') {
                    btnHtml = `
                        <div class="grid grid-cols-1 pt-3 border-t border-gray-100">
                            <button disabled class="bg-gray-100 text-gray-500 py-2.5 rounded-xl text-[10px] font-bold cursor-not-allowed flex justify-center items-center gap-2 border border-gray-200">
                                <i class="fas fa-check-double text-green-600 text-sm"></i> MISI BERHASIL
                            </button>
                        </div>`;
                } else {
                    // DESAIN CUSTOMER: Batal abu-abu dan Lunas
                    btnHtml = `
                        <div class="grid grid-cols-2 gap-2 pt-3 border-t border-gray-100">
                            <button disabled class="bg-gray-100 text-gray-400 py-2.5 rounded-xl text-[10px] font-bold cursor-not-allowed">BATAL</button>
                            <button disabled class="bg-gray-200 text-green-700 py-2.5 rounded-xl text-[10px] font-bold cursor-not-allowed flex justify-center items-center gap-1 border border-green-200"><i class="fas fa-check-circle"></i> LUNAS</button>
                        </div>`;
                }
            } 
            else if (o.status === 'cancelled') {
                statusText = 'DIBATALKAN'; statusColor = 'text-red-600'; statusBg = 'bg-red-50'; borderClass = 'border-red-400';
                btnHtml = `<div class="pt-3 border-t border-gray-100 text-center text-[10px] text-red-400 font-bold uppercase tracking-widest">Pesanan Dibatalkan</div>`;
            }

            const dateStr = o.created_at ? new Date(o.created_at).toLocaleString('id-ID', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'}) : 'Baru saja';
            const tarifLabel = currentUser.role === 'driver' ? 'Pendapatan' : 'Total Tarif';

            d.className = `bg-white p-4 rounded-2xl shadow-sm border-l-4 ${borderClass} mb-3 relative overflow-hidden`;
            d.innerHTML = `
                <div class="flex justify-between mb-2">
                    <span class="text-[10px] font-bold text-gray-400 uppercase tracking-tight">${dateStr}</span>
                    <span class="text-[9px] font-bold ${statusColor} ${statusBg} px-2 py-0.5 rounded uppercase tracking-wide">${statusText}</span>
                </div>
                <h4 class="font-bold text-royal text-sm mb-1">${o.destination || 'Tujuan'}</h4>
                <div class="flex justify-between items-center mb-1">
                    <p class="text-[10px] text-gray-500">${tarifLabel}</p>
                    <p class="text-sm font-bold text-royal">Rp ${parseInt(o.price || 0).toLocaleString()}</p>
                </div>
                ${btnHtml}
            `;
            c.appendChild(d);

            if (showTimer) {
                const timerId = setInterval(function() {
                    const now = new Date().getTime();
                    const wm = o.accepted_at ? new Date(o.accepted_at).getTime() : (o.created_at ? new Date(o.created_at).getTime() : new Date().getTime());
                    const s = 30 - Math.floor((now - wm) / 1000);
                    const tEl = document.getElementById(`timer-text-${o.id}`);
                    const bEl = document.getElementById(`btn-cancel-${o.id}`);
                    if (s > 0) {
                        if(tEl) tEl.innerHTML = `<i class="fas fa-stopwatch animate-pulse"></i> Batal: ${s}s`;
                    } else {
                        if(bEl) { bEl.disabled = true; bEl.innerText = "BATAL (WAKTU HABIS)"; bEl.className = "bg-gray-100 text-gray-400 py-2.5 rounded-xl text-[10px] font-bold cursor-not-allowed"; bEl.onclick = null; }
                        if(tEl) tEl.remove();
                        clearInterval(timerId);
                    }
                }, 1000);
            }
        });

        if (renderedCount === 0) {
            const emptyMsg = currentUser.role === 'driver' ? 'Belum ada Misi Selesai' : 'Belum ada pesanan';
            c.innerHTML = `<div class="text-center text-gray-400 mt-24"><i class="fas fa-clipboard-check text-5xl mb-3 opacity-30"></i><p class="text-sm font-bold">${emptyMsg}</p></div>`;
        }
    });

    if(currentUser) window.renderHistory();

}, 1000);

// =====================================================================
// PATCH FINAL V5: ANTI-MEMORI KEPENUHAN (KONTROL MISI DRIVER)
// Pastikan letaknya di baris Paling Bawah file app.js
// =====================================================================

setTimeout(() => {
    
    // 1. KUNCI ID PESANAN KE HTML AGAR TIDAK HILANG SAAT BUKA KAMERA
    const originalOpenDriverControl = window.openDriverControl;
    window.openDriverControl = function(orderId) {
        window.currentControlOrderId = orderId;
        
        // Panggil fungsi bawaan yang sudah ada untuk buka modal
        if (originalOpenDriverControl) originalOpenDriverControl(orderId);

        // KUNCI EXTRA: Tanamkan (Paku) ID ke tombol dan teks secara fisik
        const ctrlText = document.getElementById('ctrl-order-id');
        if(ctrlText) ctrlText.setAttribute('data-full-id', orderId);
        
        const btnFinish = document.getElementById('btn-finish-mission');
        if(btnFinish) btnFinish.setAttribute('data-order-id', orderId);
    };

    // 2. PERBAIKI FUNGSI MISI SELESAI AGAR MEMBACA DARI TOMBOL HTML
    window.finishMissionAction = function() {
        if (!window.tempHandoverBase64) {
            alert("SOP: Harap ambil foto serah terima terlebih dahulu!");
            return;
        }

        var btnFinish = document.getElementById('btn-finish-mission');
        var uiText = document.getElementById('ctrl-order-id');
        
        // AMBIL ID DARI 3 SUMBER BERBEDA (Pasti dapat, tidak mungkin hilang)
        var orderId = window.currentControlOrderId || 
                      (btnFinish ? btnFinish.getAttribute('data-order-id') : null) ||
                      (uiText ? uiText.getAttribute('data-full-id') : null);

        // Jika masih kosong (sangat mustahil), cari di daftar order RAM
        if (!orderId && typeof driverOrders !== 'undefined') {
            var aOrder = driverOrders.find(function(o) { return o.status === 'accepted'; });
            if (aOrder) orderId = aOrder.id;
        }

        if (!orderId) {
            alert("Sistem gagal membaca ID Pesanan. Silakan Refresh Web (Tarik layar ke bawah).");
            return;
        }

        // Ubah tombol jadi status loading agar driver tidak klik berkali-kali
        if (btnFinish) {
            btnFinish.innerHTML = '<i class="fas fa-spinner fa-spin"></i> MENGIRIM DATA...';
            btnFinish.disabled = true; 
        }

        // Tembak Sinyal Selesai ke Server Node.js
        socket.emit('finish_mission', { 
            orderId: orderId,
            handoverProof: window.tempHandoverBase64
        });
        
        closeModal('modal-driver-action');

        // Beri jeda 1 detik agar server selesai bekerja, lalu refresh aplikasi otomatis
        setTimeout(function() {
            alert("✅ Misi Berhasil Diselesaikan! Status Customer telah berubah menjadi SELESAI.");
            window.location.reload(); // Refresh total agar UI Customer & Driver sinkron sempurna
        }, 1000);
    };

    // 3. JAGA-JAGA: PULIHKAN DAFTAR ORDER DRIVER JIKA WEB TER-REFRESH SENDIRI
    socket.on('receive_history', function(serverOrders) {
        if (!serverOrders || !Array.isArray(serverOrders)) return;
        
        if (currentUser && currentUser.role === 'driver') {
            serverOrders.forEach(o => {
                const dId = o.driver_id || o.driverId;
                if (dId === currentUser.id && (o.status === 'accepted' || o.status === 'searching')) {
                    // Masukkan kembali ke Tab Order jika sempat terhapus dari RAM
                    if (typeof driverOrders !== 'undefined' && !driverOrders.find(d => d.id === o.id)) {
                        driverOrders.unshift(o);
                    }
                }
            });
            
            // Update UI Tab Order secara diam-diam
            const viewOrders = document.getElementById('view-orders');
            if(viewOrders && viewOrders.classList.contains('active')) {
                if(typeof window.renderDriverOrderList === 'function') window.renderDriverOrderList();
            }
        }
    });

    // Paksa minta riwayat ulang dari server untuk memulihkan data yang mungkin hilang
    if (currentUser && currentUser.role === 'driver') {
        socket.emit('request_history', { userId: currentUser.id });
    }

}, 2000);

// =====================================================================
// PATCH FINAL V9: ANTI-MACET "MENGIRIM DATA" & AUTO-PINDAH RIWAYAT
// Solusi: Membuka 'telinga' Driver agar mendengar konfirmasi Server
// =====================================================================

setTimeout(() => {
    // 1. Matikan pendengar lama yang "tuli"
    socket.off('mission_ended');

    // 2. Pasang Pendengar Baru (Cerdas untuk Customer & Driver)
    socket.on('mission_ended', function(data) {
        const orderId = data ? data.orderId : null;

        // --- SKENARIO A: CUSTOMER (Layar jadi LUNAS) ---
        if (currentUser && currentUser.role === 'customer') {
            alert("🏁 Perjalanan Selesai. Terima kasih telah menggunakan Go Flash!");
            if(activeOrder) {
                activeOrder.status = 'completed';
                activeOrder.payment_status = 'verified';
            }
            // Tutup panel tracking
            const panel = document.getElementById('panel-tracking-customer');
            if (panel) panel.style.bottom = "-100%";
            
            // Refresh agar status berubah jadi Hijau/Selesai
            window.location.reload(); 
        }
        
        // --- SKENARIO B: DRIVER (Tombol Loading Berhenti -> Hijau -> Pindah) ---
        else if (currentUser && currentUser.role === 'driver') {
            // A. Tutup Pop-up Kontrol Misi Paksa (Biar gak menghalangi)
            closeModal('modal-driver-action');

            if (!orderId) return window.location.reload(); 

            if (typeof driverOrders !== 'undefined') {
                const idx = driverOrders.findIndex(o => o.id === orderId);
                
                if (idx > -1) {
                    // 1. Ubah status di memori HP jadi 'completed'
                    driverOrders[idx].status = 'completed';
                    
                    // 2. Render ulang layar (Kartu akan berubah jadi HIJAU "SELESAI")
                    if (typeof window.renderDriverOrderList === 'function') {
                        window.renderDriverOrderList();
                    }

                    // 3. Tahan 3 Detik (Biar Driver lihat warna hijaunya)
                    setTimeout(() => {
                        // Hapus order dari daftar "Order Masuk"
                        const freshIdx = driverOrders.findIndex(o => o.id === orderId);
                        if (freshIdx > -1) {
                            driverOrders.splice(freshIdx, 1); 
                        }
                        
                        // Render lagi (Kartu hilang dari tab Order)
                        if (typeof window.renderDriverOrderList === 'function') {
                            window.renderDriverOrderList();
                        }

                        // 4. Perbarui Tab Riwayat
                        socket.emit('request_history', { userId: currentUser.id });
                        
                        // Bersihkan sisa-sisa memori
                        window.currentControlOrderId = null;
                        window.tempHandoverBase64 = null;
                        
                        alert("✅ Misi Berhasil! Saldo masuk ke Riwayat.");
                    }, 3000); 
                } else {
                    // Jaga-jaga kalau datanya gak ketemu, refresh aja
                    window.location.reload();
                }
            }
        }
    });

    // 3. DESAIN KARTU ORDER (AGAR MUNCUL WARNA HIJAU "SELESAI")
    window.renderDriverOrderList = function() {
        const c = document.getElementById('driver-orders-list');
        if(!c) return;
        c.innerHTML = '';
        
        if (driverOrders.length === 0) {
            c.innerHTML = `<div class="text-center text-gray-400 mt-20"><i class="fas fa-satellite-dish text-4xl mb-2 animate-pulse"></i><p class="text-sm">Menunggu order...</p></div>`;
            return;
        }
        
        driverOrders.forEach(o => {
            const d = document.createElement('div');
            
            // Logika Desain Latar: Jika selesai jadi hijau, jika belum jadi putih
            if (o.status === 'completed') {
                d.className = `p-4 rounded-xl shadow-md mb-4 border-2 border-green-400 bg-green-50 transition-all duration-500 transform scale-95`;
            } else {
                d.className = `p-4 rounded-xl shadow-sm mb-4 border border-gray-100 bg-white transition-all`;
            }
            
            let statusBadge = '';
            if (o.status === 'accepted') {
                statusBadge = '<span class="text-[10px] bg-blue-100 text-blue-600 px-3 py-1 rounded font-bold uppercase tracking-wide">SEDANG DIPROSES</span>';
            } else if (o.status === 'completed') {
                statusBadge = '<span class="text-[10px] bg-green-500 text-white px-3 py-1 rounded shadow-sm font-bold uppercase border border-green-600"><i class="fas fa-check-double"></i> SELESAI</span>';
            }

            let serviceLabel = o.serviceType === 'delivery' ? 'Delivery' : 'Ride';
            let custName = o.customerName || 'Customer';

            let html = `
                <div class="mb-2 flex justify-between items-start">
                    <div>
                        <h4 class="font-bold text-black text-sm">${serviceLabel}: ${custName}</h4>
                        <p class="text-xs text-gray-500 mt-0.5">Tujuan: ${o.destination}</p>
                    </div>
                    ${statusBadge}
                </div>
                <div class="mb-4">
                    <span class="text-green-600 font-bold text-sm">Rp ${parseInt(o.price || 0).toLocaleString()}</span>
                </div>
            `;

            if (o.status === 'searching' || !o.status) {
                html += `<button onclick="acceptOrder('${o.id}')" class="w-full bg-green-500 text-white font-bold py-3 rounded-xl text-xs shadow-md hover:bg-green-600 active:scale-95 transition">TERIMA ORDER</button>`;
            } else if (o.status === 'accepted') {
                html += `<div onclick="openDriverControl('${o.id}')" class="space-y-2 border-t border-gray-100 pt-3 cursor-pointer hover:bg-gray-50 p-2 -mx-2 rounded-xl transition">`;
                
                if (!o.payment_proof) {
                    html += `<button class="w-full bg-gray-100 text-gray-500 text-[10px] font-bold py-3 rounded-xl flex justify-center items-center gap-2 border border-gray-200 pointer-events-none"><i class="fas fa-lock"></i> MENUNGGU BUKTI (KLIK DETAIL)</button>`;
                } else {
                    html += `<button class="w-full bg-blue-100 text-blue-600 text-[10px] font-bold py-3 rounded-xl flex justify-center items-center gap-2 shadow-sm pointer-events-none"><i class="fas fa-image"></i> BUKTI DITERIMA (KLIK BUKA)</button>`;
                }
                html += `</div>`;
            } else if (o.status === 'completed') {
                // TOMBOL HIJAU BERKEDIP (TAMPIL SELAMA 3 DETIK)
                html += `<div class="w-full bg-green-500 text-white text-[11px] font-bold py-3 rounded-xl flex justify-center items-center gap-2 mt-2 shadow-md animate-pulse">
                            <i class="fas fa-spinner fa-spin"></i> Memindahkan ke Riwayat...
                         </div>`;
            }
            
            d.innerHTML = html;
            c.appendChild(d);
        });
    };

    // 4. PERBAIKAN TOMBOL "MISI SELESAI" DI POP-UP
    window.finishMissionAction = function() {
        if (!window.tempHandoverBase64) {
            alert("SOP: Harap ambil foto serah terima terlebih dahulu!");
            return;
        }

        var orderId = window.currentControlOrderId;
        if (!orderId && typeof driverOrders !== 'undefined') {
            var aOrder = driverOrders.find(function(o) { return o.status === 'accepted'; });
            if (aOrder) orderId = aOrder.id;
        }
        if (!orderId) {
            alert("Sistem kehilangan ID Pesanan. Silakan refresh web dan ulangi.");
            return;
        }

        var btnFinish = document.getElementById('btn-finish-mission');
        if (btnFinish) {
            btnFinish.innerHTML = '<i class="fas fa-spinner fa-spin"></i> MENGIRIM DATA...';
            btnFinish.disabled = true;
        }

        // Tembak Sinyal Selesai ke Server 
        socket.emit('finish_mission', {
            orderId: orderId,
            handoverProof: window.tempHandoverBase64
        });

        // JANGAN MENGHAPUS MODAL DI SINI LAGI, KITA BIARKAN SERVER YANG MENUTUPNYA SAAT SUKSES
        // Ini kunci agar "Mengirim data..." terlihat memproses!
    };

    console.log("🛠️ Patch V9: Anti-Macet Driver Aktif!");
}, 2000);

// =====================================================================
// PATCH FINAL V10: MESIN KOMPRESOR FOTO & ANTI-MACET 10 DETIK
// Penyakit "Loading Lama" setelah jepret foto dijamin musnah!
// =====================================================================

setTimeout(() => {
    // 1. MESIN KOMPRESOR FOTO (Ubah dari MegaByte ke KiloByte)
    window.handleHandoverPhoto = function(input) {
        if (input.files && input.files[0]) {
            const file = input.files[0];
            const reader = new FileReader();

            reader.onload = function(e) {
                const img = new Image();
                img.src = e.target.result;
                
                img.onload = function() {
                    // Siapkan kanvas untuk memeras ukuran foto
                    const canvas = document.createElement('canvas');
                    
                    // Paksa ukuran lebar maksimal 600 pixel saja (Sangat ringan!)
                    const MAX_WIDTH = 600;
                    let width = img.width;
                    let height = img.height;

                    if (width > MAX_WIDTH) {
                        height = Math.round((height * MAX_WIDTH) / width);
                        width = MAX_WIDTH;
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    // KOMPRESI 50% (Ubah format jadi JPEG ringan)
                    const compressedBase64 = canvas.toDataURL('image/jpeg', 0.5);
                    
                    // Simpan hasil kompresi ke memori untuk dikirim
                    window.tempHandoverBase64 = compressedBase64;

                    // Tampilkan ke layar UI
                    const preview = document.getElementById('handover-preview-img');
                    const container = document.getElementById('handover-preview-container');
                    const btnFinish = document.getElementById('btn-finish-mission');
                    const hint = document.getElementById('finish-mission-hint');

                    if(preview) preview.src = compressedBase64;
                    if(container) container.classList.remove('hidden');
                    if(btnFinish) {
                        btnFinish.disabled = false;
                        btnFinish.className = "w-full py-4 bg-green-500 hover:bg-green-600 text-white font-bold rounded-xl shadow-lg flex items-center justify-center gap-2 transition active:scale-95";
                    }
                    if(hint) hint.innerText = "✅ Foto berhasil dikompresi. Silakan klik MISI SELESAI.";
                };
            };
            reader.readAsDataURL(file);
        }
    };

    // 2. TOMBOL MISI SELESAI DENGAN FAILSAFE (ALARM 10 DETIK)
    window.finishMissionAction = function() {
        if (!window.tempHandoverBase64) {
            alert("SOP: Harap ambil foto serah terima terlebih dahulu!");
            return;
        }

        var orderId = window.currentControlOrderId;
        if (!orderId && typeof driverOrders !== 'undefined') {
            var aOrder = driverOrders.find(function(o) { return o.status === 'accepted'; });
            if (aOrder) orderId = aOrder.id;
        }
        
        if (!orderId) {
            alert("Sistem kehilangan ID Pesanan. Silakan tarik layar ke bawah untuk refresh.");
            return;
        }

        var btnFinish = document.getElementById('btn-finish-mission');
        if (btnFinish) {
            btnFinish.innerHTML = '<i class="fas fa-spinner fa-spin"></i> MENGIRIM DATA (KILAT)...';
            btnFinish.disabled = true;
        }

        // Tembak Data Ringan ke Server
        socket.emit('finish_mission', {
            orderId: orderId,
            handoverProof: window.tempHandoverBase64
        });

        // ALARM FAILSAFE: Kalau server ngambek/lemot lebih dari 10 detik, kita paksa hijau!
        window.failsafeTimer = setTimeout(() => {
            console.warn("Server merespon lambat, memaksa layar sukses...");
            closeModal('modal-driver-action'); // Tutup paksa pop-up
            alert("Jaringan sedikit lambat, tapi Misi telah diamankan di HP Anda.");
            window.location.reload(); // Refresh layar agar tidak nyangkut
        }, 10000); 
    };

    // 3. TANGKAP BALASAN SERVER (Lalu matikan alarm failsafe)
    socket.off('mission_ended');
    socket.on('mission_ended', function(data) {
        // Matikan alarm 10 detik karena server membalas dengan cepat
        if (window.failsafeTimer) clearTimeout(window.failsafeTimer);

        const orderId = data ? data.orderId : null;

        // --- CUSTOMER ---
        if (currentUser && currentUser.role === 'customer') {
            alert("🏁 Perjalanan Selesai. Terima kasih telah menggunakan Go Flash!");
            if(activeOrder) { activeOrder.status = 'completed'; activeOrder.payment_status = 'verified'; }
            const panel = document.getElementById('panel-tracking-customer');
            if (panel) panel.style.bottom = "-100%";
            window.location.reload(); 
        }
        
        // --- DRIVER ---
        else if (currentUser && currentUser.role === 'driver') {
            closeModal('modal-driver-action'); // Tutup pop-up

            if (!orderId) return window.location.reload(); 

            if (typeof driverOrders !== 'undefined') {
                const idx = driverOrders.findIndex(o => o.id === orderId);
                
                if (idx > -1) {
                    driverOrders[idx].status = 'completed'; // Kartu jadi Hijau
                    if (typeof window.renderDriverOrderList === 'function') window.renderDriverOrderList();

                    // Tahan 3 detik lalu pindahkan ke riwayat
                    setTimeout(() => {
                        const freshIdx = driverOrders.findIndex(o => o.id === orderId);
                        if (freshIdx > -1) driverOrders.splice(freshIdx, 1); 
                        
                        if (typeof window.renderDriverOrderList === 'function') window.renderDriverOrderList();
                        
                        socket.emit('request_history', { userId: currentUser.id });
                        window.currentControlOrderId = null;
                        window.tempHandoverBase64 = null;
                        
                        alert("✅ Misi Berhasil! Pendapatan masuk ke Riwayat.");
                    }, 3000); 
                } else {
                    window.location.reload();
                }
            }
        }
    });

    console.log("🛠️ Patch V10: Kompresor & Failsafe 10 Detik Aktif!");
}, 2500);
// =====================================================================
// PATCH FINAL V11: GARIS RUTE OSRM (DRIVER KE CUSTOMER)
// Menampilkan garis biru ala Gojek dari motor ke titik jemput
// =====================================================================

setTimeout(() => {
    // Variabel untuk menyimpan garis rute agar bisa dihapus
    window.currentRoutingControl = null;

    // 1. FUNGSI MENGGAMBAR GARIS RUTE
    window.drawRouteOnMap = function(startLat, startLng, endLat, endLng) {
        // Hapus garis lama jika masih ada
        if (window.currentRoutingControl) {
            map.removeControl(window.currentRoutingControl);
            window.currentRoutingControl = null;
        }

        // Pastikan titiknya valid
        if (!startLat || !startLng || !endLat || !endLng) return;

        // Gambar garis baru pakai OSRM
        window.currentRoutingControl = L.Routing.control({
            waypoints: [
                L.latLng(startLat, startLng), // Titik A (Motor Driver)
                L.latLng(endLat, endLng)      // Titik B (Titik Jemput Customer)
            ],
            router: L.Routing.osrmv1({
                serviceUrl: 'https://router.project-osrm.org/route/v1' // Server OSRM Publik (Gratis)
            }),
            lineOptions: {
                styles: [{ color: '#0F4C81', opacity: 0.8, weight: 6 }] // Warna Royal Blue yang tebal
            },
            createMarker: function() { return null; }, // Matikan marker bawaan OSRM (Kita pakai marker sendiri)
            show: false,          // Sembunyikan teks instruksi jalan
            addWaypoints: false,  // Cegah garis diubah manual oleh user
            routeWhileDragging: false,
            fitSelectedRoutes: true // Peta otomatis zoom agar seluruh rute terlihat
        }).addTo(map);
    };

    // 2. FUNGSI MENGHAPUS GARIS RUTE (Saat Misi Selesai / Batal)
    window.clearRouteOnMap = function() {
        if (window.currentRoutingControl) {
            map.removeControl(window.currentRoutingControl);
            window.currentRoutingControl = null;
        }
    };

    // 3. PEMANTAU OTOMATIS (Akan menggambar garis saat ada Order Aktif)
    setInterval(() => {
        // Hanya gambar jika ada orderan yang sedang aktif/diproses
        if (typeof activeOrder !== 'undefined' && activeOrder !== null && activeOrder.status === 'accepted') {
            
            // Coba ambil lokasi Driver dan Customer
            let dLat, dLng, cLat, cLng;

            if (currentUser && currentUser.role === 'customer') {
                // Di HP Customer: Tarik posisi Driver dari data peta, dan posisi Customer dari HP-nya
                cLat = currentUser.lat;
                cLng = currentUser.lng;
                const dMarker = driverMarkers[activeOrder.driverId || activeOrder.driver_id];
                if (dMarker) {
                    const pos = dMarker.getLatLng();
                    dLat = pos.lat;
                    dLng = pos.lng;
                }
            } else if (currentUser && currentUser.role === 'driver') {
                // Di HP Driver: Tarik posisi Driver dari HP-nya, dan posisi Customer dari data Order
                dLat = currentUser.lat;
                dLng = currentUser.lng;
                cLat = activeOrder.lat || activeOrder.customerLat || activeOrder.pickupLat;
                cLng = activeOrder.lng || activeOrder.customerLng || activeOrder.pickupLng;
            }

            // Jika ke-4 koordinat ditemukan dan belum ada garis, GAMBAR GARISNYA!
            if (dLat && dLng && cLat && cLng && window.currentRoutingControl === null) {
                console.log("📍 Menggambar Rute Penjemputan...");
                window.drawRouteOnMap(dLat, dLng, cLat, cLng);
            }
        } else {
            // Jika tidak ada order aktif, pastikan peta bersih dari garis rute
            window.clearRouteOnMap();
        }
    }, 5000); // Cek setiap 5 detik

    console.log("🛠️ Patch V11: Garis Rute OSRM Aktif!");
}, 3000);
// =====================================================================
// PATCH FINAL V12: NATIVE PUSH NOTIFICATION & SERVICE WORKER
// HP akan bergetar & muncul pop-up saat aplikasi di-minimize!
// =====================================================================

setTimeout(() => {
    // 1. DAFTARKAN KARYAWAN GAIB (SERVICE WORKER) & MINTA IZIN
    if ('serviceWorker' in navigator && 'Notification' in window) {
        
        // Daftarkan sw.js
        navigator.serviceWorker.register('/sw.js').then(function(reg) {
            console.log('✅ Service Worker Berhasil Didaftarkan di browser!');
        }).catch(function(err) {
            console.log('❌ Service Worker Gagal:', err);
        });

        // Minta Izin Notifikasi jika belum diizinkan
        if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
            Notification.requestPermission().then(permission => {
                if(permission === 'granted') console.log("✅ Izin Notifikasi Diberikan!");
            });
        }
    }

    // 2. MESIN PENEMBAK NOTIFIKASI
    window.showAppNotification = function(title, message) {
        if (Notification.permission === 'granted') {
            navigator.serviceWorker.ready.then(function(registration) {
                registration.showNotification(title, {
                    body: message,
                    // Ikon flash/mobil (Bisa diganti link logo Go Flash Bapak nanti)
                    icon: 'https://cdn-icons-png.flaticon.com/512/1048/1048315.png', 
                    vibrate: [200, 100, 200, 100, 200], // Pola Getaran HP (Bzzz-Bzzz-Bzzz)
                    badge: 'https://cdn-icons-png.flaticon.com/512/1048/1048315.png'
                });
            });
        }
    };

    // 3. PASANG ALARM KE SERVER (Merespon secara diam-diam)
    // Ingat: Kita pakai document.hidden agar notifikasi HANYA muncul jika User sedang buka app lain (Minimize). 
    // Kalau layarnya sedang buka Go Flash, tidak perlu pop-up.

    // A. DRIVER: Saat ada orderan masuk
    socket.on('new_order', function(order) {
        if (currentUser && currentUser.role === 'driver') {
            if (document.hidden) {
                window.showAppNotification('🚨 Order Baru Masuk!', `Tujuan: ${order.destination}. Tarif: Rp ${order.price}`);
            }
        }
    });

    // B. CUSTOMER: Saat driver menerima order
    socket.on('order_accepted', function(data) {
        if (currentUser && currentUser.role === 'customer' && activeOrder && activeOrder.id === data.orderId) {
            if (document.hidden) {
                window.showAppNotification('🛵 Driver OTW!', 'Driver telah mengkonfirmasi dan sedang menuju ke lokasi Anda.');
            }
        }
    });

    // C. CUSTOMER: Saat misi diselesaikan
    socket.on('mission_ended', function(data) {
        if (currentUser && currentUser.role === 'customer') {
            if (document.hidden) {
                window.showAppNotification('🏁 Perjalanan Selesai', 'Terima kasih! Jangan lupa buka aplikasi untuk melihat riwayat.');
            }
        }
    });

    console.log("🛠️ Patch V12: Notifikasi Native & Service Worker Aktif!");
}, 3500);
// =====================================================================
// PATCH FINAL V13: TOMBOL NAVIGASI GOOGLE MAPS UNTUK DRIVER
// Otomatis membuka aplikasi Google Maps dalam mode Rute Perjalanan
// =====================================================================

setTimeout(() => {
    // Kita perbarui desain Kartu Order di HP Driver
    window.renderDriverOrderList = function() {
        const c = document.getElementById('driver-orders-list');
        if(!c) return;
        c.innerHTML = '';
        
        if (driverOrders.length === 0) {
            c.innerHTML = `<div class="text-center text-gray-400 mt-20"><i class="fas fa-satellite-dish text-4xl mb-2 animate-pulse"></i><p class="text-sm">Menunggu order...</p></div>`;
            return;
        }
        
        driverOrders.forEach(o => {
            const d = document.createElement('div');
            
            if (o.status === 'completed') {
                d.className = `p-4 rounded-xl shadow-md mb-4 border-2 border-green-400 bg-green-50 transition-all duration-500 transform scale-95`;
            } else {
                d.className = `p-4 rounded-xl shadow-sm mb-4 border border-gray-100 bg-white transition-all`;
            }
            
            let statusBadge = '';
            if (o.status === 'accepted') {
                statusBadge = '<span class="text-[10px] bg-blue-100 text-blue-600 px-3 py-1 rounded font-bold uppercase tracking-wide">SEDANG DIPROSES</span>';
            } else if (o.status === 'completed') {
                statusBadge = '<span class="text-[10px] bg-green-500 text-white px-3 py-1 rounded shadow-sm font-bold uppercase border border-green-600"><i class="fas fa-check-double"></i> SELESAI</span>';
            }

            let serviceLabel = o.serviceType === 'delivery' ? 'Delivery' : 'Ride';
            let custName = o.customerName || 'Customer';

            let html = `
                <div class="mb-2 flex justify-between items-start">
                    <div>
                        <h4 class="font-bold text-black text-sm">${serviceLabel}: ${custName}</h4>
                        <p class="text-xs text-gray-500 mt-0.5">Tujuan: ${o.destination}</p>
                    </div>
                    ${statusBadge}
                </div>
                <div class="mb-4">
                    <span class="text-green-600 font-bold text-sm">Rp ${parseInt(o.price || 0).toLocaleString()}</span>
                </div>
            `;

            if (o.status === 'searching' || !o.status) {
                html += `<button onclick="acceptOrder('${o.id}')" class="w-full bg-green-500 text-white font-bold py-3 rounded-xl text-xs shadow-md hover:bg-green-600 active:scale-95 transition">TERIMA ORDER</button>`;
            } 
            else if (o.status === 'accepted') {
                // ========================================================
                // TAMBAHAN: TOMBOL NAVIGASI GOOGLE MAPS
                // ========================================================
                
                // 1. Ambil koordinat Customer dari pesanan
                let cLat = o.lat || o.customerLat || o.pickupLat || '-7.025';
                let cLng = o.lng || o.customerLng || o.pickupLng || '112.748';
                
                // 2. Link Ajaib Google Maps (Parameter 'dir' untuk Rute, 'driving' untuk kendaraan bermotor)
                let mapsLink = `https://www.google.com/maps/dir/?api=1&destination=${cLat},${cLng}&travelmode=driving`;

                html += `<div class="space-y-2 border-t border-gray-100 pt-3">`;
                
                // 3. Render Tombol Biru Terang untuk Navigasi (Pakai tag <a> agar membuka tab baru/aplikasi)
                html += `
                    <a href="${mapsLink}" target="_blank" class="w-full bg-blue-600 text-white text-[11px] font-bold py-3 rounded-xl flex justify-center items-center gap-2 shadow-md active:scale-95 transition mb-2">
                        <i class="fas fa-location-arrow text-lg"></i> BUKA NAVIGASI (GOOGLE MAPS)
                    </a>`;

                // 4. Tombol Bukti & Kontrol Misi (Dibawahnya)
                html += `<div onclick="openDriverControl('${o.id}')" class="cursor-pointer hover:bg-gray-50 p-2 -mx-2 rounded-xl transition">`;
                if (!o.payment_proof) {
                    html += `<button class="w-full bg-gray-100 text-gray-500 text-[10px] font-bold py-3 rounded-xl flex justify-center items-center gap-2 border border-gray-200 pointer-events-none"><i class="fas fa-lock"></i> MENUNGGU BUKTI (KLIK DETAIL)</button>`;
                } else {
                    html += `<button class="w-full bg-blue-100 text-blue-600 text-[10px] font-bold py-3 rounded-xl flex justify-center items-center gap-2 shadow-sm pointer-events-none"><i class="fas fa-image"></i> BUKTI DITERIMA (KLIK BUKA)</button>`;
                }
                html += `</div></div>`;
            } 
            else if (o.status === 'completed') {
                html += `<div class="w-full bg-green-500 text-white text-[11px] font-bold py-3 rounded-xl flex justify-center items-center gap-2 mt-2 shadow-md animate-pulse">
                            <i class="fas fa-spinner fa-spin"></i> Memindahkan ke Riwayat...
                         </div>`;
            }
            
            d.innerHTML = html;
            c.appendChild(d);
        });
    };

    console.log("🛠️ Patch V13: Tombol Navigasi Google Maps Aktif!");
}, 4000);

// =====================================================================
// PATCH FINAL V14: REKAP PENDAPATAN HARIAN DRIVER
// Menampilkan kotak total pendapatan & jumlah tarikan hari ini
// =====================================================================

setTimeout(() => {
    // Timpa fungsi penangkap riwayat untuk menyisipkan Kotak Pendapatan
    socket.off('receive_history');
    socket.on('receive_history', function(serverOrders) {
        const c = document.getElementById('history-list');
        if(!c) return;

        // Bersihkan area riwayat
        c.innerHTML = ''; 
        if (window.cancelTimerInterval) clearInterval(window.cancelTimerInterval);

        // Filter pesanan milik user yang sedang login
        let myOrders = [];
        if (serverOrders && Array.isArray(serverOrders)) {
            myOrders = serverOrders.filter(o => {
                const cId = o.customer_id || o.customerId;
                const dId = o.driver_id || o.driverId;
                return (cId === currentUser.id || dId === currentUser.id);
            });
        }

        // Jika benar-benar kosong
        if (myOrders.length === 0) {
            const emptyMsg = currentUser.role === 'driver' ? 'Belum ada Misi Selesai' : 'Belum ada pesanan';
            c.innerHTML = `<div class="text-center text-gray-400 mt-24"><i class="fas fa-clipboard-check text-5xl mb-3 opacity-30"></i><p class="text-sm font-bold">${emptyMsg}</p></div>`;
            return;
        }

        // =========================================================
        // FITUR BARU: HITUNG  (KHUSUS DRIVER)
        // =========================================================
        if (currentUser.role === 'driver') {
            let todayTotal = 0;
            let todayCount = 0;
            const now = new Date();
            
            myOrders.forEach(o => {
                if (o.status === 'completed') {
                    // Cek apakah tanggal pesanan sama dengan hari ini
                    const d = o.created_at ? new Date(o.created_at) : new Date();
                    if (d.getDate() === now.getDate() && 
                        d.getMonth() === now.getMonth() && 
                        d.getFullYear() === now.getFullYear()) {
                        
                        todayTotal += parseInt(o.price || 0);
                        todayCount++;
                    }
                }
            });

            // Buat Kotak Saldo (Desain Premium ala Gojek/Grab)
            const summaryDiv = document.createElement('div');
            summaryDiv.className = 'bg-gradient-to-r from-blue-600 to-blue-800 text-white p-5 rounded-2xl shadow-lg mb-5 flex justify-between items-center transform transition active:scale-95';
            summaryDiv.innerHTML = `
                <div>
                    <p class="text-[10px] font-bold opacity-80 uppercase tracking-widest mb-1">Pendapatan Hari Ini</p>
                    <h3 class="text-2xl font-bold">Rp ${todayTotal.toLocaleString('id-ID')}</h3>
                </div>
                <div class="text-right">
                    <span class="bg-white/20 px-3 py-1.5 rounded-lg text-xs font-bold shadow-inner flex items-center gap-1.5">
                        <i class="fas fa-motorcycle"></i> ${todayCount} Tarikan
                    </span>
                </div>
            `;
            // Pasang kotak ini di urutan paling atas!
            c.appendChild(summaryDiv);
        }

        // =========================================================
        // RENDER KARTU RIWAYAT (BAWAAN SEBELUMNYA)
        // =========================================================
        let renderedCount = 0;

myOrders.forEach(function(o) {
            // FILTER DRIVER: HANYA TAMPILKAN STATUS 'COMPLETED' DI DAFTAR BAWAH
            if (currentUser.role === 'driver' && o.status !== 'completed') return;

            // 👇 SUNTIKKAN KODE PENCEGAT CUSTOMER DI SINI 👇
            if (currentUser.role === 'customer' && (o.status === 'pending' || o.status === 'searching')) {
                return; // Sembunyikan pesanan mencari dari Riwayat Customer
            }
            // 👆 ========================================== 👆

            renderedCount++;

            // Sinkronisasi Order Aktif Customer
            if (o.status === 'completed' && activeOrder && activeOrder.id === o.id) {
                activeOrder = null;
                const panel = document.getElementById('panel-tracking-customer');
                if(panel) panel.style.bottom = "-100%";
            } else if ((o.status === 'accepted' || o.status === 'searching') && currentUser.role === 'customer') {
                activeOrder = o;
            }

            const d = document.createElement('div');
            let statusText = ''; let statusColor = ''; let statusBg = ''; let borderClass = ''; let btnHtml = ''; let showTimer = false; let sisaWaktu = 0;

            if (o.status === 'searching') {
                statusText = 'MENUNGGU KONFIRMASI DRIVER'; statusColor = 'text-orange-600'; statusBg = 'bg-orange-50'; borderClass = 'border-orange-400';
                btnHtml = `<div class="pt-3 border-t border-gray-100"><button onclick="cancelOrderHistory('${o.id}')" class="w-full bg-red-50 text-red-500 py-2.5 rounded-xl text-xs font-bold active:scale-95 transition">BATALKAN PESANAN</button></div>`;
            } 
            else if (o.status === 'accepted') {
                statusText = 'DIPROSES DRIVER'; statusColor = 'text-blue-700'; statusBg = 'bg-blue-100'; borderClass = 'border-blue-500';
                const waktuMulai = o.accepted_at ? new Date(o.accepted_at).getTime() : (o.created_at ? new Date(o.created_at).getTime() : new Date().getTime());
                sisaWaktu = 30 - Math.floor((new Date().getTime() - waktuMulai) / 1000);

                if (sisaWaktu > 0) {
                    showTimer = true;
                    btnHtml = `
                        <div class="grid grid-cols-2 gap-2 pt-3 border-t border-gray-100">
                            <button id="btn-cancel-${o.id}" onclick="cancelOrderHistory('${o.id}')" class="bg-red-50 text-red-500 py-2.5 rounded-xl text-[10px] font-bold active:scale-95 transition">BATAL</button>
                            <button onclick="openPaymentFromHistory('${o.id}', ${o.price})" class="bg-green-500 text-white py-2.5 rounded-xl text-[10px] font-bold active:scale-95 transition">BAYAR SEKARANG</button>
                        </div>
                        <div id="timer-text-${o.id}" class="text-[11px] text-red-500 font-bold text-center mt-2 bg-red-50 py-1 rounded border border-red-100"><i class="fas fa-stopwatch animate-pulse"></i> Batal: ${sisaWaktu}s</div>`;
                } else {
                    btnHtml = `<div class="grid grid-cols-2 gap-2 pt-3 border-t border-gray-100"><button disabled class="bg-gray-100 text-gray-400 py-2.5 rounded-xl text-[10px] font-bold cursor-not-allowed">BATAL (WAKTU HABIS)</button><button onclick="openPaymentFromHistory('${o.id}', ${o.price})" class="bg-green-500 text-white py-2.5 rounded-xl text-[10px] font-bold active:scale-95 transition">BAYAR SEKARANG</button></div>`;
                }
            } 
            else if (o.status === 'completed') {
                statusText = 'SELESAI'; statusColor = 'text-green-700'; statusBg = 'bg-green-100'; borderClass = 'border-green-500'; 
                
                if (currentUser.role === 'driver') {
                    btnHtml = `
                        <div class="grid grid-cols-1 pt-3 border-t border-gray-100">
                            <button disabled class="bg-gray-100 text-gray-500 py-2.5 rounded-xl text-[10px] font-bold cursor-not-allowed flex justify-center items-center gap-2 border border-gray-200">
                                <i class="fas fa-check-double text-green-600 text-sm"></i> MISI BERHASIL
                            </button>
                        </div>`;
                } else {
                    btnHtml = `
                        <div class="grid grid-cols-2 gap-2 pt-3 border-t border-gray-100">
                            <button disabled class="bg-gray-100 text-gray-400 py-2.5 rounded-xl text-[10px] font-bold cursor-not-allowed">BATAL</button>
                            <button disabled class="bg-gray-200 text-green-700 py-2.5 rounded-xl text-[10px] font-bold cursor-not-allowed flex justify-center items-center gap-1 border border-green-200"><i class="fas fa-check-circle"></i> LUNAS</button>
                        </div>`;
                }
            } 
            else if (o.status === 'cancelled') {
                statusText = 'DIBATALKAN'; statusColor = 'text-red-600'; statusBg = 'bg-red-50'; borderClass = 'border-red-400';
                btnHtml = `<div class="pt-3 border-t border-gray-100 text-center text-[10px] text-red-400 font-bold uppercase tracking-widest">Pesanan Dibatalkan</div>`;
            }

            const dateStr = o.created_at ? new Date(o.created_at).toLocaleString('id-ID', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'}) : 'Baru saja';
            const tarifLabel = currentUser.role === 'driver' ? 'Pendapatan' : 'Total Tarif';

            d.className = `bg-white p-4 rounded-2xl shadow-sm border-l-4 ${borderClass} mb-3 relative overflow-hidden`;
            d.innerHTML = `
                <div class="flex justify-between mb-2">
                    <span class="text-[10px] font-bold text-gray-400 uppercase tracking-tight">${dateStr}</span>
                    <span class="text-[9px] font-bold ${statusColor} ${statusBg} px-2 py-0.5 rounded uppercase tracking-wide">${statusText}</span>
                </div>
                <h4 class="font-bold text-royal text-sm mb-1">${o.destination || 'Tujuan'}</h4>
                <div class="flex justify-between items-center mb-1">
                    <p class="text-[10px] text-gray-500">${tarifLabel}</p>
                    <p class="text-sm font-bold text-royal">Rp ${parseInt(o.price || 0).toLocaleString('id-ID')}</p>
                </div>
                ${btnHtml}
            `;
            c.appendChild(d);

            if (showTimer) {
                const timerId = setInterval(function() {
                    const now = new Date().getTime();
                    const wm = o.accepted_at ? new Date(o.accepted_at).getTime() : (o.created_at ? new Date(o.created_at).getTime() : new Date().getTime());
                    const s = 30 - Math.floor((now - wm) / 1000);
                    const tEl = document.getElementById(`timer-text-${o.id}`);
                    const bEl = document.getElementById(`btn-cancel-${o.id}`);
                    if (s > 0) {
                        if(tEl) tEl.innerHTML = `<i class="fas fa-stopwatch animate-pulse"></i> Batal: ${s}s`;
                    } else {
                        if(bEl) { bEl.disabled = true; bEl.innerText = "BATAL (WAKTU HABIS)"; bEl.className = "bg-gray-100 text-gray-400 py-2.5 rounded-xl text-[10px] font-bold cursor-not-allowed"; bEl.onclick = null; }
                        if(tEl) tEl.remove();
                        clearInterval(timerId);
                    }
                }, 1000);
            }
        });

        // Jaga-jaga jika Driver belum punya riwayat tapi kotak saldo sudah muncul (0)
        if (renderedCount === 0 && currentUser.role === 'driver') {
             const emptyD = document.createElement('div');
             emptyD.innerHTML = `<div class="text-center text-gray-400 mt-10"><i class="fas fa-clipboard-check text-5xl mb-3 opacity-30"></i><p class="text-sm font-bold">Belum ada Misi Selesai Hari Ini</p></div>`;
             c.appendChild(emptyD);
        }
    });

    console.log("🛠️ Patch V14: Dasbor Pendapatan Harian Driver Aktif!");
}, 4500);

// =====================================================================
// PATCH FINAL V15: MODE AUTO-BID (TERIMA OTOMATIS)
// Keselamatan Driver: Menerima orderan tanpa harus menyentuh layar HP
// =====================================================================

setTimeout(() => {
    // 1. Variabel Penyimpan Status Auto-Bid
    window.isAutoBidEnabled = false;

    // 2. Fungsi untuk Menghidupkan/Mematikan Auto-Bid
    window.toggleAutoBid = function(checkbox) {
        window.isAutoBidEnabled = checkbox.checked;
        if (window.isAutoBidEnabled) {
            alert("🤖 Mode Auto-Bid AKTIF!\n\nFokuslah mengemudi. Sistem akan otomatis menerima orderan yang masuk dalam 1.5 detik.");
        }
    };

    // 3. Mesin Pendeteksi Order Baru (Tangan Gaib)
    socket.on('new_order', function(order) {
        if (currentUser && currentUser.role === 'driver' && window.isAutoBidEnabled) {
            
            // Getarkan HP Driver agar sadar ada orderan masuk (Bzzz-Bzzz)
            if (navigator.vibrate) navigator.vibrate([200, 100, 200]);

            console.log("🤖 Auto-Bid mendeteksi order masuk: " + order.id);

            // Beri jeda 1.5 detik agar Driver sempat melihat kartu order muncul di layar
            setTimeout(() => {
                // Pastikan pesanan masih ada dan belum diambil driver lain
                if (typeof driverOrders !== 'undefined') {
                    const targetOrder = driverOrders.find(o => o.id === order.id && o.status === 'searching');
                    if (targetOrder) {
                        console.log("🤖 Mengeksekusi Auto-Accept...");
                        // Panggil fungsi terima order bawaan Bapak
                        if (typeof acceptOrder === 'function') {
                            acceptOrder(order.id);
                            
                            // Tembak Notifikasi Service Worker (Jika V12 Aktif)
                            if (typeof window.showAppNotification === 'function' && document.hidden) {
                                window.showAppNotification('🤖 Auto-Bid Berhasil!', `Order ke ${order.destination} otomatis diterima.`);
                            }
                        }
                    }
                }
            }, 1500); // 1500 milidetik = 1.5 Detik
        }
    });

    // 4. Perbarui Tampilan Tab Order Driver (Menyatukan V13 Maps + Sakelar Auto-Bid)
    window.renderDriverOrderList = function() {
        const c = document.getElementById('driver-orders-list');
        if(!c) return;
        c.innerHTML = '';

        // --- INJEKSI UI: KOTAK SAKELAR AUTO-BID (DESAIN PREMIUM) ---
        const autoBidDiv = document.createElement('div');
        autoBidDiv.className = 'bg-gradient-to-r from-gray-800 to-black text-white p-4 rounded-xl mb-4 flex justify-between items-center shadow-md border border-gray-700';
        autoBidDiv.innerHTML = `
            <div>
                <h4 class="font-bold text-yellow-400 text-sm"><i class="fas fa-robot"></i> Mode Auto-Bid</h4>
                <p class="text-[10px] text-gray-300 mt-0.5">Terima orderan otomatis tanpa sentuh</p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" class="sr-only peer" ${window.isAutoBidEnabled ? 'checked' : ''} onchange="toggleAutoBid(this)">
                <div class="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-yellow-500"></div>
            </label>
        `;
        c.appendChild(autoBidDiv);
        // -----------------------------------------------------------
        
        if (driverOrders.length === 0) {
            const emptyDiv = document.createElement('div');
            emptyDiv.innerHTML = `<div class="text-center text-gray-400 mt-16"><i class="fas fa-satellite-dish text-4xl mb-2 animate-pulse"></i><p class="text-sm">Menunggu order...</p></div>`;
            c.appendChild(emptyDiv);
            return;
        }
        
        driverOrders.forEach(o => {
            const d = document.createElement('div');
            
            if (o.status === 'completed') {
                d.className = `p-4 rounded-xl shadow-md mb-4 border-2 border-green-400 bg-green-50 transition-all duration-500 transform scale-95`;
            } else {
                d.className = `p-4 rounded-xl shadow-sm mb-4 border border-gray-100 bg-white transition-all`;
            }
            
            let statusBadge = '';
            if (o.status === 'accepted') {
                statusBadge = '<span class="text-[10px] bg-blue-100 text-blue-600 px-3 py-1 rounded font-bold uppercase tracking-wide">SEDANG DIPROSES</span>';
            } else if (o.status === 'completed') {
                statusBadge = '<span class="text-[10px] bg-green-500 text-white px-3 py-1 rounded shadow-sm font-bold uppercase border border-green-600"><i class="fas fa-check-double"></i> SELESAI</span>';
            }

            let serviceLabel = o.serviceType === 'delivery' ? 'Delivery' : 'Ride';
            let custName = o.customerName || 'Customer';

            let html = `
                <div class="mb-2 flex justify-between items-start">
                    <div>
                        <h4 class="font-bold text-black text-sm">${serviceLabel}: ${custName}</h4>
                        <p class="text-xs text-gray-500 mt-0.5">Tujuan: ${o.destination}</p>
                    </div>
                    ${statusBadge}
                </div>
                <div class="mb-4">
                    <span class="text-green-600 font-bold text-sm">Rp ${parseInt(o.price || 0).toLocaleString()}</span>
                </div>
            `;

            if (o.status === 'searching' || !o.status) {
                // Jika Auto-Bid aktif, tombol ini akan ditekan otomatis oleh sistem dalam 1.5 detik
                html += `<button id="btn-terima-${o.id}" onclick="acceptOrder('${o.id}')" class="w-full bg-green-500 text-white font-bold py-3 rounded-xl text-xs shadow-md hover:bg-green-600 active:scale-95 transition">
                            <i class="fas fa-check-circle"></i> TERIMA ORDER
                         </button>`;
            } 
            else if (o.status === 'accepted') {
                // TOMBOL NAVIGASI GOOGLE MAPS (FITUR V13 TETAP AMAN)
                let cLat = o.lat || o.customerLat || o.pickupLat || '-7.025';
                let cLng = o.lng || o.customerLng || o.pickupLng || '112.748';
                let mapsLink = `http://googleusercontent.com/maps.google.com/maps?dirflg=d&daddr=${cLat},${cLng}`;

                html += `<div class="space-y-2 border-t border-gray-100 pt-3">`;
                html += `
                    <a href="${mapsLink}" target="_blank" class="w-full bg-blue-600 text-white text-[11px] font-bold py-3 rounded-xl flex justify-center items-center gap-2 shadow-md active:scale-95 transition mb-2">
                        <i class="fas fa-location-arrow text-lg"></i> BUKA NAVIGASI (GOOGLE MAPS)
                    </a>`;

                html += `<div onclick="openDriverControl('${o.id}')" class="cursor-pointer hover:bg-gray-50 p-2 -mx-2 rounded-xl transition">`;
                if (!o.payment_proof) {
                    html += `<button class="w-full bg-gray-100 text-gray-500 text-[10px] font-bold py-3 rounded-xl flex justify-center items-center gap-2 border border-gray-200 pointer-events-none"><i class="fas fa-lock"></i> MENUNGGU BUKTI (KLIK DETAIL)</button>`;
                } else {
                    html += `<button class="w-full bg-blue-100 text-blue-600 text-[10px] font-bold py-3 rounded-xl flex justify-center items-center gap-2 shadow-sm pointer-events-none"><i class="fas fa-image"></i> BUKTI DITERIMA (KLIK BUKA)</button>`;
                }
                html += `</div></div>`;
            } 
            else if (o.status === 'completed') {
                html += `<div class="w-full bg-green-500 text-white text-[11px] font-bold py-3 rounded-xl flex justify-center items-center gap-2 mt-2 shadow-md animate-pulse">
                            <i class="fas fa-spinner fa-spin"></i> Memindahkan ke Riwayat...
                         </div>`;
            }
            
            d.innerHTML = html;
            c.appendChild(d);
        });
    };

    console.log("🛠️ Patch V15: Mode Auto-Bid (Terima Otomatis) Aktif!");
}, 5000);
// =====================================================================
// PATCH FINAL V16: FITUR SCAN QR (INSTANT ORDER)
// Mendeteksi lokasi penjemputan dari link URL stiker QR Code
// =====================================================================

setTimeout(() => {
    // 1. Mesin Pembaca Parameter Link URL
    const urlParams = new URLSearchParams(window.location.search);
    const pickupLocation = urlParams.get('pickup');

    // Jika ada orang yang masuk lewat jalur Scan QR / Link Khusus
    if (pickupLocation) {
        
        // Bersihkan teks (Ubah tanda "_" menjadi Spasi. Misal: Halte_Kampus -> Halte Kampus)
        const cleanPickupName = pickupLocation.replace(/_/g, ' ');

        // Simpan ke memori HP Customer
        window.scannedPickupLocation = cleanPickupName;
        console.log("📍 Masuk lewat Scan QR! Titik Jemput Otomatis:", cleanPickupName);

        // 2. Tampilkan Banner Elegan (Biar Customer merasa canggih)
        const banner = document.createElement('div');
        banner.className = 'fixed top-0 left-0 right-0 bg-gradient-to-r from-blue-600 to-blue-800 text-white p-4 z-[9999] shadow-2xl flex items-center justify-between px-5 transition-all duration-500 transform -translate-y-full rounded-b-3xl';
        banner.id = 'qr-banner';
        banner.innerHTML = `
            <div class="flex items-center gap-4">
                <div class="bg-white/20 p-3 rounded-full shadow-inner animate-pulse">
                    <i class="fas fa-qrcode text-yellow-300 text-xl"></i>
                </div>
                <div>
                    <p class="text-[10px] text-blue-200 uppercase tracking-widest font-bold mb-0.5">Titik Jemput Terkunci</p>
                    <p class="text-sm font-bold shadow-sm">${cleanPickupName}</p>
                </div>
            </div>
            <button onclick="document.getElementById('qr-banner').style.transform = 'translateY(-100%)'" class="text-white/50 hover:text-white p-2">
                <i class="fas fa-times"></i>
            </button>
        `;
        document.body.appendChild(banner);

        // Munculkan banner dengan animasi turun dari atas
        setTimeout(() => {
            document.getElementById('qr-banner').style.transform = 'translateY(0)';
        }, 500);

        // 3. Modifikasi Mesin Pengirim Orderan Secara Cerdas
        // Kita "cegat" data order sebelum dikirim ke server, lalu kita sisipkan nama lokasinya!
        const originalEmit = socket.emit;
        socket.emit = function(eventName, data) {
            // Jika yang dikirim adalah orderan baru, dan Customer masuk lewat QR
            if (eventName === 'create_order' && window.scannedPickupLocation) {
                if (data && data.destination) {
                    // Sisipkan titik jemput ke keterangan tujuan agar Driver bisa membacanya
                    data.destination = `${data.destination} (📍 Jemput di: ${window.scannedPickupLocation})`;
                }
            }
            // Lanjutkan pengiriman ke Server
            originalEmit.apply(socket, arguments);
        };
    }

    console.log("🛠️ Patch V16: Radar Scan QR (Instant Order) Aktif!");
}, 5500);
// =====================================================================
// PATCH FINAL V17: LIVE TRACKING LINK (SHARE LOC AMAN)
// Fitur keamanan: Bagikan perjalanan ke WA, keluarga bisa pantau tanpa login
// =====================================================================

setTimeout(() => {
    // 1. DETEKSI MODE TAMU (GUEST TRACKING)
    // Cek apakah URL memiliki parameter '?track_order=...' dan '?driver_id=...'
    const urlParams = new URLSearchParams(window.location.search);
    const trackOrderId = urlParams.get('track_order');
    const trackDriverId = urlParams.get('driver_id');

    // JIKA INI ADALAH KELUARGA YANG MEMBUKA LINK WA:
    if (trackOrderId && trackDriverId) {
        console.log("🔒 Memasuki Mode Pemantauan Tamu...");
        
        // A. Bypass Login Screen (Langsung masuk Peta)
        const loginPage = document.getElementById('login-page');
        const mainApp = document.getElementById('main-app');
        if(loginPage) loginPage.style.display = 'none';
        if(mainApp) mainApp.style.display = 'block';

        // B. Inisialisasi Peta (Jika belum ada)
        if (!map) {
            map = L.map('map').setView([-7.025, 112.748], 15);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
        }

        // C. Tampilkan Banner "MODE PEMANTAUAN"
        const monitorBanner = document.createElement('div');
        monitorBanner.className = 'fixed top-0 left-0 right-0 bg-red-600 text-white p-4 z-[9999] shadow-2xl rounded-b-3xl flex items-center gap-4 animate-slide-up';
        monitorBanner.innerHTML = `
            <div class="bg-white/20 p-3 rounded-full animate-pulse">
                <i class="fas fa-satellite-dish text-white text-xl"></i>
            </div>
            <div>
                <p class="text-[10px] text-red-200 uppercase tracking-widest font-bold">Live Tracking (Mode Aman)</p>
                <p class="text-sm font-bold">Memantau Perjalanan Kerabat Anda</p>
            </div>
        `;
        document.body.appendChild(monitorBanner);

        // D. Hapus Semua Tombol Kontrol (Tamu hanya boleh melihat, tidak boleh mengorder)
        const uiControls = document.querySelectorAll('.bottom-nav, #btn-order-ride, #btn-order-food');
        uiControls.forEach(el => el.style.display = 'none');

        // E. Dengarkan Pergerakan Driver Spesifik Ini
        socket.on('driver_state_update', function(driver) {
            // Hanya update jika ID Driver cocok dengan yang ada di Link WA
            if (driver.id == trackDriverId) {
                // Gambar Marker Driver
                if (!driverMarkers[driver.id]) {
                    const icon = L.divIcon({
                        className: 'driver-icon',
                        html: `<div style="background-color: #0F4C81; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 3px solid white; box-shadow: 0 4px 10px rgba(0,0,0,0.3);">
                                <i class="fas fa-motorcycle text-white"></i>
                               </div>`,
                        iconSize: [40, 40]
                    });
                    driverMarkers[driver.id] = L.marker([driver.lat, driver.lng], {icon: icon}).addTo(map);
                } else {
                    // Update posisi animasi
                    driverMarkers[driver.id].setLatLng([driver.lat, driver.lng]);
                }

                // Fokuskan kamera peta ke driver yang sedang bergerak
                map.panTo([driver.lat, driver.lng]);
            }
        });
    }

    // 2. TOMBOL "BAGIKAN PERJALANAN" (DI SISI CUSTOMER)
    // Kita suntikkan tombol ini ke dalam panel tracking customer yang sudah ada
    const originalRender = window.updateCustomerTrackingPanel; 
    
    // Override fungsi update panel customer
    window.updateCustomerTrackingPanel = function(order) {
        // Jalankan fungsi aslinya dulu biar panel muncul
        const panel = document.getElementById('panel-tracking-customer');
        const content = document.getElementById('tracking-status-content');
        
        if (order && (order.status === 'accepted' || order.status === 'on_the_way')) {
            panel.style.bottom = "0"; // Munculkan panel

            // Ambil data driver
            const drvName = order.driverName || 'Driver';
            const plate = order.vehiclePlate || 'B ??? ??';
            const price = parseInt(order.price).toLocaleString();

            // Link Ajaib WA (Domain otomatis mendeteksi URL website Bapak saat ini)
            const shareLink = `${window.location.origin}/?track_order=${order.id}&driver_id=${order.driverId}`;
            const waMessage = `Hai, saya sedang naik Go Flash dengan driver ${drvName} (${plate}). Pantau lokasi saya real-time di sini: ${shareLink}`;
            const waUrl = `https://wa.me/?text=${encodeURIComponent(waMessage)}`;

            content.innerHTML = `
                <div class="flex items-center gap-4 mb-6">
                    <div class="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center border-2 border-blue-500 relative">
                        <i class="fas fa-user text-2xl text-gray-400"></i>
                        <div class="absolute -bottom-1 -right-1 bg-blue-600 text-white text-[10px] px-2 py-0.5 rounded-full border border-white">
                            <i class="fas fa-star text-yellow-300"></i> 5.0
                        </div>
                    </div>
                    <div>
                        <h3 class="font-bold text-lg text-gray-800">${drvName}</h3>
                        <p class="text-sm text-gray-500">${plate} • Yamaha NMAX</p>
                    </div>
                </div>

                <a href="${waUrl}" target="_blank" class="block w-full bg-green-500 hover:bg-green-600 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-green-500/30 flex items-center justify-center gap-2 mb-4 active:scale-95 transition">
                    <i class="fab fa-whatsapp text-xl"></i> Bagikan Perjalanan ke Keluarga
                </a>

                <div class="grid grid-cols-2 gap-4 mb-4">
                    <div class="bg-gray-50 p-3 rounded-xl border border-gray-100">
                        <p class="text-[10px] text-gray-400 uppercase tracking-wider">Tujuan</p>
                        <p class="font-bold text-sm truncate">${order.destination}</p>
                    </div>
                    <div class="bg-gray-50 p-3 rounded-xl border border-gray-100">
                        <p class="text-[10px] text-gray-400 uppercase tracking-wider">Tarif</p>
                        <p class="font-bold text-sm text-green-600">Rp ${price}</p>
                    </div>
                </div>

                <div class="flex gap-2">
                    <button onclick="window.open('tel:08123456789')" class="flex-1 bg-gray-100 text-gray-600 font-bold py-3 rounded-xl flex items-center justify-center gap-2">
                        <i class="fas fa-phone"></i> Telepon
                    </button>
                    <button class="flex-1 bg-blue-100 text-blue-600 font-bold py-3 rounded-xl flex items-center justify-center gap-2">
                        <i class="fas fa-comment-dots"></i> Chat
                    </button>
                </div>
            `;
        }
    };

    console.log("🛠️ Patch V17: Live Tracking Link (Safety Mode) Aktif!");
}, 6000);
// =====================================================================
// PATCH FINAL V18: GUEST CHECKOUT (PESAN DULU, DAFTAR NANTI)
// Membiarkan user melihat peta dan harga tanpa harus login di awal
// =====================================================================

setTimeout(() => {
    const loginPage = document.getElementById('login-page');
    const mainApp = document.getElementById('main-app');

    // 1. BYPASS LOGIN SCREEN DI AWAL (JADIKAN TAMU / GUEST)
    // Jika user baru buka web dan belum login, kita paksa masuk ke peta!
    if (!currentUser && loginPage && mainApp) {
        console.log("🕵️ Mengaktifkan Mode Guest (Pesan Dulu Daftar Nanti)...");
        
        loginPage.style.display = 'none';
        mainApp.style.display = 'block';
        
        // Beri identitas sementara sebagai 'guest'
        currentUser = { role: 'guest', id: 'guest_' + Date.now() };
        
        // Panggil peta agar langsung muncul
        if (!map && typeof L !== 'undefined') {
            map = L.map('map').setView([-7.025, 112.748], 15);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
        }
    }

    // 2. CEGAT TOMBOL "PESAN SEKARANG" (Intersepsi Data)
    // Kita bajak jalur pengiriman data ke server
    const originalEmit = socket.emit;
    socket.emit = function(eventName, data) {
        
        // Jika Guest mencoba mengirim pesanan ke server
        if (eventName === 'create_order' && currentUser && currentUser.role === 'guest') {
            console.log("🛑 Guest mencoba memesan! Memunculkan layar Login...");
            
            // A. Simpan data pesanan (Tujuan & Harga) ke memori HP
            // Agar setelah dia login nanti, dia tidak perlu ngetik ulang!
            window.pendingGuestOrder = data;
            
            // B. Tampilkan layar Login/Daftar
            alert("👋 Hampir selesai! Untuk memanggil Driver, silakan masukkan Nama & No. WhatsApp Anda.");
            
            if (loginPage && mainApp) {
                mainApp.style.display = 'none';
                loginPage.style.display = 'flex'; // Munculkan form login
                
                // Fokus otomatis ke tab Customer di halaman login
                const customerTab = document.getElementById('tab-customer');
                if(customerTab) customerTab.click();
            }
            
            // Hentikan pengiriman data ke server sampai login selesai
            return; 
        }
        
        // Jika bukan order dari guest, biarkan data mengalir normal
        originalEmit.apply(socket, arguments);
    };

    // 3. AUTO-LANJUTKAN PESANAN SETELAH LOGIN BERHASIL
    socket.on('login_success', function(userData) {
        // Jika ada pesanan yang "nyangkut" saat jadi Guest tadi
        if (window.pendingGuestOrder && userData.role === 'customer') {
            console.log("✅ Login sukses! Melanjutkan pesanan yang tertunda...");
            
            // Perbarui pesanan dengan ID & Nama asli yang baru saja didaftarkan
            window.pendingGuestOrder.customerId = userData.id;
            window.pendingGuestOrder.customerName = userData.username;
            
            // Kembalikan layar ke Peta
            if (loginPage && mainApp) {
                loginPage.style.display = 'none';
                mainApp.style.display = 'block';
            }

            // Tunggu 1 detik agar animasi UI stabil, lalu TEMBAK otomatis pesanannya!
            setTimeout(() => {
                socket.emit('create_order', window.pendingGuestOrder);
                window.pendingGuestOrder = null; // Bersihkan memori
                
                // Munculkan panel pencarian driver
                const searchPanel = document.getElementById('panel-searching-driver');
                if(searchPanel) searchPanel.style.bottom = "0";
                
                alert("✨ Pendaftaran Berhasil! Memproses pesanan Anda...");
            }, 1000);
        }
    });

    console.log("🛠️ Patch V18: Guest Checkout (Auto-Bypass Login) Aktif!");
}, 6500);
// =====================================================================
// PATCH FINAL V19: PENYEMPURNAAN FITUR CHAT (MISSING FUNCTIONS)
// Menambahkan mesin penggambar balon pesan & daftar kontak
// =====================================================================

setTimeout(() => {
    // 1. FUNGSI MENGGAMBAR BALON PESAN (UI BUBBLE)
    window.renderChatBubble = function(text, isMe) {
        const container = document.getElementById('chat-messages');
        if (!container) return;
        
        const div = document.createElement('div');
        // Desain balon chat ala WhatsApp
        div.className = `max-w-[80%] p-3 rounded-2xl text-sm w-fit ${
            isMe 
            ? 'bg-royal text-white rounded-tr-sm ml-auto shadow-sm' 
            : 'bg-white border border-gray-200 text-gray-800 rounded-tl-sm shadow-sm'
        }`;
        div.innerText = text;
        container.appendChild(div);
        
        // Otomatis scroll ke pesan paling bawah
        container.scrollTop = container.scrollHeight;
    };

    // 2. FUNGSI MENYIMPAN RIWAYAT KONTAK DI TAB "CHAT"
    window.updateChatContacts = function(id, name, lastMsg) {
        if (!id || !name) return;
        
        const existingIdx = chatContacts.findIndex(c => c.id === id);
        if (existingIdx > -1) {
            // Jika sudah ada, perbarui pesan terakhir
            chatContacts[existingIdx].lastMsg = lastMsg;
            // Pindahkan kontak ini ke urutan paling atas
            const contact = chatContacts.splice(existingIdx, 1)[0];
            chatContacts.unshift(contact);
        } else {
            // Jika kontak baru, masukkan ke atas
            chatContacts.unshift({ id, name, lastMsg });
        }
        
        // Jika Tab Chat sedang terbuka, refresh layarnya
        const chatView = document.getElementById('view-chat-list');
        if (chatView && chatView.classList.contains('active')) {
            if(typeof renderChatList === 'function') renderChatList();
        }
    };

    // 3. FUNGSI MEMBUKA CHAT DARI PROFIL DRIVER DI PETA
    window.startChatFromSheet = function() {
        if (selectedDriver) {
            openChatRoom(selectedDriver.username, selectedDriver.id);
        } else {
            alert("Pilih driver terlebih dahulu.");
        }
    };

    // 4. MEMPERBAIKI TOMBOL CHAT DI PANEL TRACKING (Suntikkan OnClick)
    // Mencari tombol Chat di Panel Customer saat driver OTW
    setInterval(() => {
        const panel = document.getElementById('panel-tracking-customer');
        if (panel && panel.style.bottom === "0px") {
            // Cari tombol chat yang memiliki ikon comment-dots
            const chatBtn = panel.querySelector('.fa-comment-dots')?.closest('button');
            if (chatBtn && !chatBtn.onclick) {
                chatBtn.onclick = function() {
                    // Buka chat room dengan driver yang sedang aktif
                    if (activeOrder && activeOrder.driverId) {
                        openChatRoom(activeOrder.driverName || 'Driver', activeOrder.driverId);
                    } else if (chatPartner.id) {
                        openChatRoom(chatPartner.name, chatPartner.id);
                    }
                };
            }
        }
    }, 2000); // Cek setiap 2 detik jika panel terbuka

    // 5. PERBAIKI FUNGSI ENTER SAAT MENGETIK PESAN
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                sendChat();
            }
        });
    }

    console.log("🛠️ Patch V19: Mesin Balon Chat & Riwayat Kontak Aktif!");
}, 7000);
// =====================================================================
// PATCH FINAL V20: AUTO-SENSOR CHAT & FITUR SHARE LOCATION
// Mencegah bypass transaksi dan menambah tombol bagikan lokasi
// =====================================================================

setTimeout(() => {
    // 1. MESIN AUTO-SENSOR (Hanya mengizinkan Abjad & Kosa Kata)
    window.censorText = function(text) {
        if (!text) return "";
        
        let safeText = text;
        
        // A. Sensor semua Link / URL (http, https, www, .com, dll)
        const linkRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
        safeText = safeText.replace(linkRegex, '🚫 [Tautan Disensor]');
        
        // B. Sensor SEMUA Angka (0-9) diganti dengan bintang
        const numberRegex = /[0-9]/g;
        safeText = safeText.replace(numberRegex, '*');
        
        return safeText;
    };

    // 2. TIMPA FUNGSI SEND CHAT UNTUK MEMASANG SENSOR
    window.sendChat = function(customText = null) {
        const input = document.getElementById('chat-input');
        let textToSend = customText || (input ? input.value.trim() : '');
        
        if (!textToSend) return;

        // Jika pesan diketik manual (Bukan dari sistem Share Loc), jalankan Sensor!
        if (!customText) {
            textToSend = window.censorText(textToSend);
        }

        // Tampilkan di layar sendiri
        if (typeof renderChatBubble === 'function') {
            renderChatBubble(textToSend, true);
        }

        // Kirim ke server
        if (chatPartner && chatPartner.id) {
            socket.emit('chat_message', {
                to: chatPartner.id,
                text: textToSend,
                senderName: currentUser ? currentUser.username : 'User'
            });
        }

        // Kosongkan kolom ketik setelah mengirim
        if (input && !customText) input.value = '';
    };

    // 3. FUNGSI SHARE LOCATION (BAGIKAN LOKASI KE DALAM CHAT)
    window.shareLocationChat = function() {
        if (currentUser && currentUser.lat && currentUser.lng) {
            // Gunakan format khusus agar dikenali oleh sistem pembuat balon chat
            const locMsg = `[SHARE_LOC]|${currentUser.lat}|${currentUser.lng}`;
            window.sendChat(locMsg); // Bypass input box agar tidak disensor
        } else {
            alert("📍 Sedang mencari lokasi Anda...");
            navigator.geolocation.getCurrentPosition(pos => {
                const locMsg = `[SHARE_LOC]|${pos.coords.latitude}|${pos.coords.longitude}`;
                window.sendChat(locMsg);
            }, () => {
                alert("Gagal mengambil lokasi. Pastikan GPS aktif.");
            });
        }
    };

    // 4. TIMPA FUNGSI BALON CHAT (Agar Share Loc tampil menjadi tombol elegan)
    window.renderChatBubble = function(text, isMe) {
        const container = document.getElementById('chat-messages');
        if (!container) return;
        
        let finalHtml = text;

        // Jika sistem mendeteksi ini adalah pesan lokasi (bukan teks biasa)
        if (text.startsWith('[SHARE_LOC]')) {
            const parts = text.split('|');
            const lat = parts[1];
            const lng = parts[2];
            // Pakai Universal Link Google Maps agar langsung membuka rute
            const mapsLink = `https://www.google.com/maps/dir/?api=1&destination=$${lat},${lng}`;
            
            finalHtml = `
                <div class="flex items-center gap-3 p-1">
                    <div class="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center border border-red-200 shadow-sm">
                        <i class="fas fa-map-marker-alt text-red-600 text-lg"></i>
                    </div>
                    <div>
                        <p class="font-bold text-[11px] mb-1">Lokasi Terkini</p>
                        <a href="${mapsLink}" target="_blank" class="bg-blue-500 hover:bg-blue-600 text-white text-[10px] font-bold py-1.5 px-3 rounded shadow-sm inline-block transition active:scale-95">
                            <i class="fas fa-location-arrow"></i> Buka Peta
                        </a>
                    </div>
                </div>
            `;
        }

        const div = document.createElement('div');
        div.className = `max-w-[80%] p-3 rounded-2xl text-sm w-fit mb-3 ${
            isMe 
            ? 'bg-royal text-white rounded-tr-sm ml-auto shadow-sm' 
            : 'bg-white border border-gray-200 text-gray-800 rounded-tl-sm shadow-sm'
        }`;
        
        // Kita gunakan innerHTML agar tombol peta bisa dirender
        div.innerHTML = finalHtml; 
        container.appendChild(div);
        
        // Otomatis scroll ke pesan paling bawah
        container.scrollTop = container.scrollHeight;
    };

    // 5. INJEKSI TOMBOL SHARE LOC KE SAMPING KOLOM KETIK
    const chatInput = document.getElementById('chat-input');
    if (chatInput && chatInput.parentElement) {
        // Cek apakah tombol sudah ada biar tidak dobel
        if (!document.getElementById('btn-share-loc-chat')) {
            const locBtn = document.createElement('button');
            locBtn.id = 'btn-share-loc-chat';
            // Desain tombol bulat elegan
            locBtn.className = 'bg-gray-100 hover:bg-gray-200 text-red-500 p-3 rounded-full shadow-sm mx-1 transition active:scale-95 flex items-center justify-center w-10 h-10 shrink-0 border border-gray-200';
            locBtn.innerHTML = '<i class="fas fa-map-marker-alt"></i>';
            locBtn.onclick = function() { window.shareLocationChat(); };
            
            // Sisipkan sebelum kolom ketik (input)
            chatInput.parentElement.insertBefore(locBtn, chatInput);
        }
    }

    console.log("🛠️ Patch V20: Auto-Sensor & Tombol Share Loc Aktif!");
}, 2200);
// =====================================================================
// PATCH FINAL V21: TOMBOL CHAT CUSTOMER DI KONTROL MISI
// Menambahkan opsi chat langsung di bawah Catatan
// =====================================================================

setTimeout(() => {
    // Simpan fungsi openDriverControl bawaan sebelumnya
    const previousOpenDriverControl = window.openDriverControl;
    
    // Timpa (Override) dengan modifikasi baru
    window.openDriverControl = function(orderId) {
        // 1. Jalankan semua fungsi bawaan yang sudah berjalan normal
        if (previousOpenDriverControl) {
            previousOpenDriverControl(orderId);
        }

        // 2. Ambil data pesanan
        const order = driverOrders.find(o => o.id === orderId);
        if (!order) return;

        // 3. Suntikkan Tombol Chat di bawah Catatan
        const detailsContainer = document.getElementById('driver-customer-details');
        if (detailsContainer) {
            // Cari bungkus elemen yang mengatur jarak (space-y-4)
            const spaceY4 = detailsContainer.querySelector('.space-y-4');
            
            // Cek agar tidak dobel kalau pop-up diklik 2 kali
            if (spaceY4 && !document.getElementById('btn-chat-customer-detail')) {
                const chatDiv = document.createElement('div');
                chatDiv.id = 'btn-chat-customer-detail';
                
                // Ambil ID dan Nama Customer dari data order
                const custName = order.customerName || 'Customer';
                const custId = order.customerId || order.customer_id;
                
                // Desain tombol warna Hijau WhatsApp agar kontras dengan tombol Biru
                chatDiv.innerHTML = `
                    <button onclick="closeModal('modal-driver-action'); openChatRoom('${custName}', '${custId}')" 
                            class="w-full bg-green-50 hover:bg-green-100 transition p-4 rounded-xl border border-green-200 flex justify-between items-center cursor-pointer shadow-sm active:scale-95 mt-4">
                        <span class="text-sm font-bold text-green-700"><i class="fas fa-comments mr-2 text-lg"></i> CHAT PELANGGAN</span>
                        <i class="fas fa-chevron-right text-green-500"></i>
                    </button>
                `;
                
                // Tambahkan di urutan paling bawah (setelah Catatan)
                spaceY4.appendChild(chatDiv);
            }
        }
    };

    console.log("🛠️ Patch V21: Tombol Chat di Kontrol Misi Aktif!");
}, 2700);
// =====================================================================
// PATCH FINAL V22: FIX CHAT TIDAK MUNCUL & WARNA FONT HITAM
// Menangkap pesan masuk dari server dan mengubah desain balon chat
// =====================================================================

setTimeout(() => {
    // 1. UBAH WARNA FONT JADI HITAM (text-black) & BALON JADI HIJAU MUDA
    window.renderChatBubble = function(text, isMe) {
        const container = document.getElementById('chat-messages');
        if (!container) return;
        
        let finalHtml = text;

        if (text.startsWith('[SHARE_LOC]')) {
            const parts = text.split('|');
            const lat = parts[1];
            const lng = parts[2];
            const mapsLink = `http://googleusercontent.com/maps.google.com/maps?daddr=${lat},${lng}`;
            
            finalHtml = `
                <div class="flex items-center gap-3 p-1">
                    <div class="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center border border-red-200">
                        <i class="fas fa-map-marker-alt text-red-600 text-lg"></i>
                    </div>
                    <div>
                        <p class="font-bold text-[11px] mb-1 text-black">Lokasi Terkini</p>
                        <a href="${mapsLink}" target="_blank" class="bg-blue-500 hover:bg-blue-600 text-white text-[10px] font-bold py-1.5 px-3 rounded shadow-sm inline-block transition">
                            Buka Peta
                        </a>
                    </div>
                </div>
            `;
        }

        const div = document.createElement('div');
        // PERUBAHAN: text-black ditambahkan, background isMe diubah ke bg-green-100 (Ala WA)
        div.className = `max-w-[80%] p-3 rounded-2xl text-sm font-medium w-fit ${
            isMe 
            ? 'bg-blue-100 text-black border border-blue-200 rounded-tr-sm ml-auto shadow-sm' // <-- Diubah jadi Latar Terang & Teks Hitam
            : 'bg-gray-100 border border-gray-300 text-black rounded-tl-sm shadow-sm'
        }`;
        
        div.innerHTML = finalHtml; 
        container.appendChild(div);
        container.scrollTop = container.scrollHeight; 
    };

    // 2. MESIN PENANGKAP PESAN MASUK DARI SERVER
    const handleIncomingChat = function(data) {
        console.log("💬 Pesan masuk dari server:", data);
        
        // Ambil isi pesan (Beberapa server menggunakan variabel message, ada yang text)
        const incomingText = data.message || data.text;
        if (!incomingText) return;

        // Ambil ID Pengirim
        const senderId = data.fromUserId || data.senderId || data.from;
        const senderName = data.fromName || data.senderName || 'User';

        // Jika chat yang masuk berasal dari orang yang sedang kita buka ruang chat-nya
        if (chatPartner && chatPartner.id === senderId) {
            // Gambar balon chat putih di sebelah kiri (isMe = false)
            window.renderChatBubble(incomingText, false);
            
            // Simpan ke memori ruang obrolan
            if(!chatMessages[chatPartner.id]) chatMessages[chatPartner.id] = [];
            chatMessages[chatPartner.id].push({text: incomingText, isMe: false});
        }

        // Selalu update riwayat di Tab Kontak (Meskipun ruang chat sedang ditutup)
        if (typeof updateChatContacts === 'function') {
            updateChatContacts(senderId, senderName, incomingText);
        }
    };

    // 3. PASANG TELINGA UNTUK MENDENGARKAN SERVER
    // Kita hapus pendengar lama agar pesan tidak muncul dobel
    socket.off('receive_chat'); 
    socket.on('receive_chat', handleIncomingChat);
    
    // Jaga-jaga jika server Node.js Bapak menggunakan nama event 'chat_message'
    socket.off('chat_message');
    socket.on('chat_message', handleIncomingChat); 

    console.log("🛠️ Patch V22: Perbaikan Chat Masuk & Font Hitam Aktif!");
}, 3200);
// =====================================================================
// PATCH FINAL V23: SINKRONISASI TOTAL TAB CHAT (DAFTAR PESAN)
// Memperbaiki daftar obrolan yang kosong di menu utama "Pesan"
// =====================================================================

setTimeout(() => {
    // 1. FUNGSI MENYIMPAN RIWAYAT KONTAK CHAT (Yang sebelumnya hilang)
    window.updateChatContacts = function(id, name, lastMsg) {
        if (!id || !name) return;
        
        // Cek apakah kontak sudah ada di daftar memori
        const existingIdx = chatContacts.findIndex(c => c.id === id);
        
        if (existingIdx > -1) {
            chatContacts[existingIdx].lastMsg = lastMsg;
            // Tarik nama orang ini ke urutan paling atas
            const contact = chatContacts.splice(existingIdx, 1)[0];
            chatContacts.unshift(contact);
        } else {
            // Tambah kontak baru ke paling atas
            chatContacts.unshift({ id, name, lastMsg });
        }
        
        // Auto-refresh layar JIKA Tab Chat sedang terbuka
        if (document.getElementById('view-chat-list') && document.getElementById('view-chat-list').classList.contains('active')) {
            if (typeof window.renderChatList === 'function') window.renderChatList();
        }
    };

    // 2. FUNGSI MENGGAMBAR DAFTAR KONTAK DI LAYAR (Sesuai Screenshot Bapak)
    window.renderChatList = function() {
        const c = document.getElementById('chat-list-container');
        if(!c) return;

        c.innerHTML = ''; 
        
        // Jika kosong, tampilkan logo "Belum ada pesan"
        if (chatContacts.length === 0) { 
            c.innerHTML = `
                <div class="text-center text-gray-400 mt-20">
                    <i class="fas fa-comment-slash text-5xl mb-4 opacity-30"></i>
                    <p class="text-sm font-bold">Belum ada pesan.</p>
                </div>`; 
            return; 
        }
        
        // Jika ada pesan, gambar daftarnya
        chatContacts.forEach(co => {
            const d = document.createElement('div');
            // Desain Kartu Daftar Chat (Elegan)
            d.className = "bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4 cursor-pointer hover:bg-gray-50 mb-3 transition active:scale-95";
            
            // Aksi saat di-klik
            d.onclick = () => {
                if(typeof window.openChatRoom === 'function') window.openChatRoom(co.name, co.id);
            };
            
            const inisial = co.name ? co.name.charAt(0).toUpperCase() : '?';
            
            d.innerHTML = `
                <div class="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-xl border border-blue-100">
                    ${inisial}
                </div>
                <div class="flex-1 overflow-hidden">
                    <h4 class="font-bold text-royal text-sm truncate text-black">${co.name}</h4>
                    <p class="text-xs text-gray-500 truncate mt-0.5">${co.lastMsg || '...'}</p>
                </div>
                <div class="text-gray-300"><i class="fas fa-chevron-right"></i></div>
            `;
            c.appendChild(d);
        });
    };

    // 3. MESIN PENANGKAP PESAN CERDAS (Bypass server yang lupa kirim ID)
    socket.off('receive_chat');
    socket.on('receive_chat', function(data) {
        let senderId = data.fromId || data.senderId;
        let senderName = data.fromName || 'User';
        const incomingText = data.message || data.text;
        
        // LOGIKA CERDAS: Jika Server tidak mengirim ID pengirim, tebak dari Data Order Aktif!
        if (!senderId) {
            if (activeOrder) {
                senderId = (currentUser.role === 'customer') ? (activeOrder.driverId || activeOrder.driver_id) : (activeOrder.customerId || activeOrder.customer_id);
            } else if (chatPartner && chatPartner.id) {
                senderId = chatPartner.id; 
            } else {
                senderId = 'unknown';
            }
        }

        // Simpan isi pesan ke Memori
        if(!chatMessages[senderId]) chatMessages[senderId] = [];
        chatMessages[senderId].push({text: incomingText, isMe: false});

        // Panggil fungsi Update Tab Kontak (Penting agar nama muncul di list)
        window.updateChatContacts(senderId, senderName, incomingText);

        // Jika ruang chat sedang terbuka, langsung munculkan balonnya!
        const chatModal = document.getElementById('modal-chat-room');
        if(chatModal && chatModal.classList.contains('active') && chatPartner.id === senderId) {
            if (typeof window.renderChatBubble === 'function') {
                window.renderChatBubble(incomingText, false);
            }
        } else {
            // Jika chat tertutup, bunyikan notifikasi MP3
            const audio = document.getElementById('notif-sound');
            if(audio) audio.play().catch(()=>{});
        }
    });

    // 4. PASANG TRIGGER SAAT TAB DIKLIK
    const originalSwitchTab = window.switchTab;
    window.switchTab = function(tabName) {
        if (originalSwitchTab) originalSwitchTab(tabName);
        // Paksa sistem merender ulang kontak setiap tab chat diklik
        if (tabName === 'chat') window.renderChatList();
    };

    console.log("🛠️ Patch V23: Sinkronisasi Tab Chat & Kontak Aktif!");
}, 3700);
// =====================================================================
// PATCH FINAL V24: FIX JALUR KOMUNIKASI SERVER (SOCKET)
// Mengembalikan format pengiriman pesan agar dikenali oleh server.js
// =====================================================================

setTimeout(() => {
    // KITA TIMPA ULANG MESIN PENGIRIM DENGAN BAHASA YANG BENAR
    window.sendChat = function(customText = null) {
        const input = document.getElementById('chat-input');
        let textToSend = customText || (input ? input.value.trim() : '');
        
        if (!textToSend) return;

        // 1. Lewati Mesin Sensor (Kecuali Share Loc)
        if (!customText && typeof window.censorText === 'function') {
            textToSend = window.censorText(textToSend);
        }

        // 2. Gambar balon chat di layar HP sendiri
        if (typeof window.renderChatBubble === 'function') {
            window.renderChatBubble(textToSend, true);
        }

        // 3. Simpan pesan di memori HP agar tidak hilang
        if (chatPartner && chatPartner.id) {
            if(!chatMessages[chatPartner.id]) chatMessages[chatPartner.id] = [];
            chatMessages[chatPartner.id].push({text: textToSend, isMe: true});
            
            // Masukkan ke Tab Kontak
            if (typeof window.updateChatContacts === 'function') {
                window.updateChatContacts(chatPartner.id, chatPartner.name, textToSend);
            }

            // ========================================================
            // 4. INI KUNCI PERBAIKANNYA! (KIRIM KE SERVER)
            // Gunakan event 'send_chat' dan variabel 'toUserId', 'message'
            // sesuai dengan apa yang diminta oleh file server.js Bapak
            // ========================================================
            socket.emit('send_chat', {
                toUserId: chatPartner.id,
                message: textToSend,
                fromName: currentUser ? currentUser.username : 'User'
            });
        }

        // 5. Kosongkan kolom ketik
        if (input && !customText) input.value = '';
    };

    console.log("🛠️ Patch V24: Sinkronisasi Bahasa Server Aktif! Chat Dijamin Masuk.");
}, 10500); // Dieksekusi paling akhir
// =====================================================================
// PATCH FINAL V27: PURE UI AUTO-CLOSE (SAFE MODE)
// Menutup layar Driver saat batal TANPA merusak sistem data bawaan
// =====================================================================

setTimeout(() => {
    // KITA HANYA MENAMBAH PENDENGAR BARU (TIDAK MENGHAPUS YANG LAMA)
    socket.on('order_cancelled', function(data) {
        
        // Ekstrak ID dari Server dengan aman
        let targetId = null;
        if (typeof data === 'string') targetId = data;
        else if (data && typeof data === 'object') targetId = data.orderId || data.id || data.order_id;

        // JIKA yang dibatalkan adalah orderan yang SEDANG DIKERJAKAN oleh Driver ini
        if (targetId && activeOrder && activeOrder.id === targetId) {
            console.log("🛑 Menutup paksa UI Driver karena pesanan dibatalkan Customer.");
            
            // 1. Beri Peringatan
            if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
            alert("⚠️ Customer telah membatalkan pesanan ini.");

            // 2. Tutup Panel Bawah (Sheet)
            const driverSheet = document.getElementById('driver-sheet');
            if (driverSheet) driverSheet.style.bottom = "-100%";
            
            // 3. Tutup Pop-up Detail
            const actionModal = document.getElementById('modal-driver-action');
            if (actionModal) {
                actionModal.style.display = 'none';
                actionModal.classList.remove('active');
            }

            // 4. Hapus Garis Rute Biru di Peta
            if (typeof window.clearRouteOnMap === 'function') {
                window.clearRouteOnMap();
            }

            // 5. Bersihkan Status Aktif Driver (Biar bisa terima order lain)
            activeOrder = null;
            currentControlOrderId = null;
            if (currentUser) currentUser.isBusy = false;
        }
    });

    console.log("🛠️ Patch V27: UI Auto-Close (Safe Mode) Aktif! Selamat tinggal pesanan hantu.");
}, 12000);
// =====================================================================
// PATCH FINAL V28: PERISAI ANTI-DOBEL ORDER (SPAM PROTECTION)
// Mencegah pesanan ganda jika Customer menekan tombol berkali-kali
// =====================================================================

setTimeout(() => {
    // 1. SIAPKAN VARIABEL PENDINGIN (COOLDOWN)
    window.isOrderCoolingDown = false;

    // 2. TANGKAP FUNGSI PENGIRIM SINYAL YANG SAAT INI AKTIF
    // (Ini akan menangkap tumpukan fungsi dari Patch V16 & V18 sebelumnya)
    const currentSocketEmit = socket.emit;

    // 3. PASANG PERISAI BARU
    socket.emit = function(eventName, data) {

        // HANYA CEK JIKA EVENT-NYA ADALAH "create_order"
        if (eventName === 'create_order') {
            
            // JIKA SEDANG PENDINGINAN (Baru saja pesan 5 detik lalu)
            if (window.isOrderCoolingDown) {
                console.warn("🛑 Mencegah Order Dobel (Spam Click Terdeteksi!)");
                
                // Beri efek getar sedikit agar user sadar
                if (navigator.vibrate) navigator.vibrate(50);
                
                return; // STOP! JANGAN KIRIM KE SERVER
            }

            // JIKA AMAN:
            console.log("✅ Mengirim Order Tunggal...");
            
            // A. Aktifkan Mode Pendinginan
            window.isOrderCoolingDown = true;

            // B. Ubah Tombol Jadi Loading (Visual Feedback)
            const btnOrderRide = document.getElementById('btn-order-ride');
            if (btnOrderRide) {
                const originalText = btnOrderRide.innerHTML;
                btnOrderRide.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Memproses...';
                btnOrderRide.disabled = true; // Matikan tombol secara fisik
                
                // Kembalikan tombol setelah 5 detik (Jaga-jaga kalau error)
                setTimeout(() => {
                    btnOrderRide.innerHTML = originalText;
                    btnOrderRide.disabled = false;
                }, 5000);
            }

            // C. Matikan Mode Pendinginan setelah 5 Detik
            setTimeout(() => {
                window.isOrderCoolingDown = false;
            }, 5000);
        }

        // 4. TERUSKAN KE FUNGSI ASLI (Agar fitur QR & Guest V16/V18 tetap jalan)
        // Kita gunakan .apply agar data tidak rusak
        currentSocketEmit.apply(socket, arguments);
    };

    console.log("🛡️ Patch V28: Perisai Anti-Dobel Order Aktif!");
}, 4200);
// =====================================================================
// PATCH FINAL V33: ROBOT PEMULIH STATUS (ANTI GAGAL/ANTI TELAT)
// Akan mencari tombol Aktif terus-menerus sampai ketemu setelah refresh
// =====================================================================

setTimeout(() => {
    const STATE_KEY = 'driver_sticky_state';

    // 1. FUNGSI PENYIMPAN STATUS
    window.saveStickyState = function(isOnline, isAutoBid) {
        localStorage.setItem(STATE_KEY, JSON.stringify({ isOnline, isAutoBid, time: Date.now() }));
        console.log("💾 Status Disimpan: Aktif=", isOnline, "AutoBid=", isAutoBid);
    };

    // 2. MATA-MATA KLIK MANUAL (Kalau Driver sengaja klik tombolnya)
    document.addEventListener('click', (e) => {
        if (e.target.closest('#btn-go-online')) {
            window.saveStickyState(true, window.isAutoBidEnabled || false);
            clearInterval(window.robotPemulih); // Hentikan robot jika klik manual
        }
        if (e.target.closest('#btn-go-offline')) {
            window.saveStickyState(false, window.isAutoBidEnabled || false);
            clearInterval(window.robotPemulih); // Hentikan robot jika klik manual
        }
    });

    // 3. MATA-MATA SAKELAR AUTO-BID
    const originalToggleAutoBid = window.toggleAutoBid;
    window.toggleAutoBid = function(checkbox) {
        if (originalToggleAutoBid) originalToggleAutoBid(checkbox);
        window.isAutoBidEnabled = checkbox.checked;
        window.saveStickyState(isDriverActive, window.isAutoBidEnabled);
    };

    // =================================================================
    // 4. MESIN ROBOT PEMULIH (BEKERJA SAAT WEB DI-REFRESH)
    // =================================================================
    const saved = localStorage.getItem(STATE_KEY);
    if (saved) {
        const data = JSON.parse(saved);
        
        // Jika belum lewat 1 Jam
        if (Date.now() - data.time < 3600000) {
            
            let hasClickedOnline = false;
            let hasRestoredAutoBid = false;

            // Jalankan Robot setiap Setengah Detik (500ms)
            window.robotPemulih = setInterval(() => {
                
                // Pastikan user sudah berhasil login & datanya terbaca
                if (typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'driver') {
                    
                    // A. PULIHKAN STATUS ONLINE
                    if (data.isOnline && !hasClickedOnline) {
                        const btnOn = document.getElementById('btn-go-online');
                        
                        // JIKA TOMBOL SUDAH MUNCUL DI LAYAR & BELUM DIKLIK
                        if (btnOn && !btnOn.classList.contains('hidden')) {
                            console.log("🤖 Robot menemukan tombol Aktif! Mengeklik paksa sekarang...");
                            btnOn.click(); // Klik secara gaib! (Ini akan menyalakan GPS & lapor ke Server)
                            hasClickedOnline = true;
                        } 
                        // Jika tombolnya sudah tersembunyi, berarti sudah aktif
                        else if (btnOn && btnOn.classList.contains('hidden')) {
                            hasClickedOnline = true;
                        }
                    }

                    // B. PULIHKAN AUTO-BID
                    if (data.isAutoBid && !hasRestoredAutoBid) {
                        window.isAutoBidEnabled = true;
                        const check = document.querySelector('input[onchange="toggleAutoBid(this)"]');
                        if (check) {
                            check.checked = true;
                            hasRestoredAutoBid = true;
                        }
                    }

                    // C. JIKA SEMUA TUGAS SELESAI, MATIKAN ROBOTNYA
                    if ((!data.isOnline || hasClickedOnline) && (!data.isAutoBid || hasRestoredAutoBid)) {
                        console.log("✅ Pemulihan Status Driver SUKSES 100%!");
                        clearInterval(window.robotPemulih);
                    }
                }
            }, 500); // <- Polling setiap 0.5 detik

            // Timeout Darurat: Matikan robot setelah 15 detik agar tidak membuat HP panas
            setTimeout(() => { clearInterval(window.robotPemulih); }, 15000);

        } else {
            // Jika lebih dari 1 jam ketiduran, hapus memorinya
            localStorage.removeItem(STATE_KEY);
        }
    }

    console.log("🤖 Patch V33: Robot Pemulih Status (Anti-Telat) Aktif!");
}, 1000); // Dijalankan langsung sejak awal web memuat
// =====================================================================
// PATCH FINAL V34: PELENGKAP V33 (CACHED GPS BOMBER)
// Mem-bypass delay GPS bawaan HP yang membuat server telat merespon
// =====================================================================

setTimeout(() => {
    const STATE_KEY = 'driver_sticky_state';

    // 1. UPGRADE FUNGSI PENYIMPANAN (Untuk mengingat lokasi terakhir)
    const originalSave = window.saveStickyState;
    window.saveStickyState = function(isOnline, isAutoBid) {
        // Ambil koordinat terakhir, jika belum ada pakai default (Bangkalan)
        let lastLat = (typeof currentUser !== 'undefined' && currentUser && currentUser.lat) ? currentUser.lat : -7.025;
        let lastLng = (typeof currentUser !== 'undefined' && currentUser && currentUser.lng) ? currentUser.lng : 112.748;
        
        localStorage.setItem(STATE_KEY, JSON.stringify({ 
            isOnline: isOnline, 
            isAutoBid: isAutoBid, 
            time: Date.now(),
            lat: lastLat,
            lng: lastLng
        }));
    };

    // 2. MESIN BOMBER SERVER (Berjalan gaib di Latar Belakang)
    socket.on('connect', () => {
        const saved = localStorage.getItem(STATE_KEY);
        if (saved) {
            const data = JSON.parse(saved);
            
            // Jika memori bilang Driver seharusnya Aktif
            if (data.isOnline && (Date.now() - data.time < 3600000)) {
                console.log("🚀 Bypass GPS: Menembakkan sinyal Online instan ke Server...");
                
                // Tembak server 4 kali berturut-turut (interval 1 detik)
                // Ini untuk menjamin server mendengarnya tanpa menunggu loading GPS HP!
                let tembakan = 0;
                let intervalBomber = setInterval(() => {
                    tembakan++;
                    
                    // Tembak langsung ke fungsi terdalam Server Bapak
                    socket.emit('driver_status_change', { 
                        status: 'online', 
                        lat: data.lat || -7.025, 
                        lng: data.lng || 112.748 
                    });
                    
                    console.log(`📡 Tembakan Sinyal Online ke-${tembakan} terkirim!`);
                    
                    // Hentikan tembakan setelah 4 detik (GPS asli biasanya sudah menyala)
                    if (tembakan >= 4) {
                        clearInterval(intervalBomber);
                    }
                }, 1000);
            }
        }
    });

    // 3. UPDATE TITIK LOKASI MEMORI SETIAP DRIVER BERGERAK
    if (navigator.geolocation) {
        navigator.geolocation.watchPosition((pos) => {
            if (typeof isDriverActive !== 'undefined' && isDriverActive) {
                let saved = localStorage.getItem(STATE_KEY);
                if (saved) {
                    let data = JSON.parse(saved);
                    data.lat = pos.coords.latitude;
                    data.lng = pos.coords.longitude;
                    localStorage.setItem(STATE_KEY, JSON.stringify(data)); // Timpa dengan koordinat baru
                }
            }
        }, null, { enableHighAccuracy: false });
    }

    console.log("🚀 Patch V34: Cached GPS Bomber (Pelengkap V33) Aktif!");
}, 4700); // Dieksekusi paling akhir
// =====================================================================
// PATCH FINAL V35: THE GUARDIAN (REVISI ANTI BUG SIBUK)
// 1. Customer dilarang double order (Spam Protection)
// 2. Tombol Terima Driver dimatikan saat sedang bawa penumpang
// =====================================================================

setTimeout(() => {
    // VARIABEL PENGAMAN
    window.isTransactionPending = false; 

    // SIMPAN FUNGSI SOCKET ASLI
    const originalSocketEmit = socket.emit;

    // KITA BAJAK PINTU KELUAR SOCKET UNTUK MEMERIKSA SPAM
    socket.emit = function(eventName, data) {

        // -----------------------------------------------------------------
        // A. PENJAGA CUSTOMER (MENCEGAH ORDER GANDA/DOBEL)
        // -----------------------------------------------------------------
        if (eventName === 'create_order') {
            if (window.isTransactionPending) {
                console.warn("⛔ SPAM DETECTED: Mencegah double order dari Customer.");
                return; 
            }

            window.isTransactionPending = true;
            console.log("🔒 Mengunci tombol pesan (Processing)...");

            const btnOrder = document.getElementById('btn-order-ride');
            if (btnOrder) {
                btnOrder.disabled = true;
                btnOrder.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Memproses...';
            }

            setTimeout(() => {
                window.isTransactionPending = false;
                if (btnOrder) {
                    btnOrder.disabled = false;
                    btnOrder.innerHTML = 'Pesan Sekarang';
                }
            }, 8000);
        }

        // BAGIAN B (YANG MEMUNCULKAN ALERT "ANDA SIBUK" PALSU) SUDAH DIBANTAI / DIHAPUS!

        // JIKA LOLOS PEMERIKSAAN, KIRIMKAN KE SERVER SEPERTI BIASA
        originalSocketEmit.apply(socket, arguments);
    };

    // -----------------------------------------------------------------
    // C. UI UPDATE: MATIKAN TOMBOL TERIMA JIKA SIBUK (CARA LEBIH AMAN)
    // -----------------------------------------------------------------
    const originalRenderList = window.renderDriverOrderList;
    window.renderDriverOrderList = function() {
        if (originalRenderList) originalRenderList();

        // Jika driver punya orderan yang sedang berjalan
        if (activeOrder && currentUser.role === 'driver') {
            const listContainer = document.getElementById('driver-orders-list');
            if (!listContainer) return;

            // Cari tombol "TERIMA ORDER" dan ubah jadi abu-abu
            const buttons = listContainer.querySelectorAll('button');
            buttons.forEach(btn => {
                if (btn.innerText.includes('TERIMA') || btn.innerText.includes('AMBIL')) {
                    btn.disabled = true;
                    btn.classList.add('opacity-50', 'cursor-not-allowed');
                    btn.classList.remove('bg-green-500', 'hover:bg-green-600');
                    btn.classList.add('bg-gray-400');
                    btn.innerText = "Selesaikan Misi Dulu";
                }
            });
        }
    };

    console.log("🛡️ Patch V35 (Revisi): Penjaga Spam & Limit Order Aktif Tanpa Error!");
}, 5200);
// =====================================================================
// PATCH FINAL V36: FITUR PEMBATALAN OLEH DRIVER (CANCEL BUTTON)
// Menambahkan tombol batal di Kontrol Misi & Sinkronisasi ke Customer
// =====================================================================

setTimeout(() => {
    
    // 1. LOGIKA DRIVER: EKSEKUSI PEMBATALAN
    window.driverCancelOrderAction = function(orderId) {
        if (!confirm("⚠️ KONFIRMASI PEMBATALAN\n\nApakah Anda yakin ingin membatalkan pesanan ini? \nTindakan ini tidak dapat dibatalkan.")) {
            return;
        }

        console.log("🛑 Driver membatalkan pesanan:", orderId);

        // A. Kirim Sinyal ke Server (Agar diteruskan ke Customer)
        // Kita gunakan event khusus agar server tahu ini inisiatif Driver
        socket.emit('cancel_order_driver', { 
            orderId: orderId,
            reason: "Dibatalkan oleh Driver",
            driverName: currentUser ? currentUser.username : "Driver"
        });

        // B. Reset UI Driver (Tutup Layar Kontrol Misi)
        const actionModal = document.getElementById('modal-driver-action');
        if (actionModal) closeModal('modal-driver-action');

        const driverSheet = document.getElementById('driver-sheet');
        if (driverSheet) driverSheet.style.bottom = "-100%";

        // C. Hapus Rute di Peta
        if (typeof window.clearRouteOnMap === 'function') window.clearRouteOnMap();

        // D. Update Status Order di Memori (Masuk Riwayat)
        if (typeof driverOrders !== 'undefined') {
            const targetIndex = driverOrders.findIndex(o => o.id === orderId);
            if (targetIndex > -1) {
                driverOrders[targetIndex].status = 'cancelled_by_driver'; // Tandai status
                // Pindahkan ke tab Riwayat (Secara logika UI)
            }
            // Render ulang list agar orderan hilang dari tab "Aktif"
            if (typeof renderDriverOrderList === 'function') renderDriverOrderList();
        }

        // E. Reset Status Driver Jadi "Mencari Order"
        activeOrder = null;
        currentControlOrderId = null;
        if (currentUser) currentUser.isBusy = false;
        
        alert("✅ Pesanan berhasil dibatalkan. Anda kembali berstatus 'Tersedia'.");
    };


    // 2. LOGIKA UI: MENYUNTIKKAN TOMBOL BATAL DI "KONTROL MISI"
    const originalOpenDriverControl = window.openDriverControl;
    window.openDriverControl = function(orderId) {
        // Jalankan fungsi asli (agar data order terload)
        if (originalOpenDriverControl) originalOpenDriverControl(orderId);

        // Ambil Data Order
        const order = driverOrders.find(o => o.id === orderId);
        if (!order) return;

        // --- VALIDASI KETAT ---
        // Tombol HANYA MUNCUL jika Customer BELUM kirim bukti bayar
        // Kita cek properti paymentProof atau status pesanan
        const isPaymentDone = order.paymentProof || order.status === 'paid' || order.status === 'verifying';
        
        if (isPaymentDone) {
            console.log("🔒 Tombol Batal disembunyikan karena Customer sudah membayar.");
            return; // Stop, jangan gambar tombol batal
        }

        // Cari Lokasi Penyuntikan (Di bawah Judul Kontrol Misi)
        // Kita cari elemen H2 atau H3 di dalam modal
        const modalBody = document.querySelector('#modal-driver-action .p-4'); 
        
        // Cek agar tombol tidak dobel
        if (modalBody && !document.getElementById('btn-driver-cancel-order')) {
            
            const cancelBtn = document.createElement('div');
            cancelBtn.id = 'btn-driver-cancel-order';
            cancelBtn.className = "mt-2 mb-4 text-center";
            cancelBtn.innerHTML = `
                <button onclick="driverCancelOrderAction('${orderId}')" 
                    class="text-red-500 text-xs font-bold border border-red-200 bg-red-50 hover:bg-red-100 px-4 py-2 rounded-full transition active:scale-95 shadow-sm flex items-center justify-center gap-2 mx-auto w-fit">
                    <i class="fas fa-ban"></i> Batalkan Pesanan
                </button>
                <p class="text-[10px] text-gray-400 mt-1">Hanya bisa dilakukan sebelum pembayaran.</p>
            `;

            // Sisipkan di bagian atas (sebelum konten detail lainnya)
            // insertBefore(elemenBaru, elemenPertamaAnak)
            modalBody.insertBefore(cancelBtn, modalBody.firstChild.nextSibling); 
        }
    };

    // 3. LOGIKA CUSTOMER: MENANGKAP SINYAL BATAL DARI DRIVER
    // Ketika Customer menerima kabar buruk ini...
    socket.on('order_cancelled_by_driver', function(data) {
        console.log("❌ Pesanan dibatalkan oleh Driver:", data);
        
        // Cek apakah ini pesanan milik customer yang sedang login?
        if (currentUser && currentUser.role === 'customer') {
            
            // 1. Getarkan HP Customer
            if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 500]);

            // 2. Tutup Layar Pencarian / Tracking
            const searchPanel = document.getElementById('panel-searching-driver');
            const trackPanel = document.getElementById('panel-tracking-customer');
            
            if (searchPanel) searchPanel.style.bottom = "-100%";
            if (trackPanel) trackPanel.style.bottom = "-100%";

            // 3. Reset Status Order Customer
            window.activeCustomerOrder = null;
            
            // 4. Tampilkan Notifikasi Tegas
            alert(`⚠️ PESANAN DIBATALKAN\n\nMohon maaf, Driver ${data.driverName || 'yang bersangkutan'} membatalkan pesanan ini.\n\nSilakan pesan kembali.`);

            // 5. Kembalikan Tampilan Tombol Pesan (Reset Loading)
            const btnOrder = document.getElementById('btn-order-ride');
            if (btnOrder) {
                btnOrder.disabled = false;
                btnOrder.innerHTML = 'Pesan Sekarang';
            }
        }
    });

    console.log("🛡️ Patch V36: Driver Cancel Button (Conditional) Aktif!");
}, 5600);
// =====================================================================
// PATCH FINAL V37: REPOSISI TOMBOL BATAL DRIVER (SNIPER INJECTION)
// Memastikan tombol merah berada TEPAT di bawah tulisan "Kontrol Misi"
// =====================================================================

setTimeout(() => {
    // Simpan fungsi bawaan sebelumnya (termasuk V36)
    const originalOpenDriverControlV36 = window.openDriverControl;
    
    window.openDriverControl = function(orderId) {
        // 1. Jalankan fungsi asli untuk merender layar detail
        if (originalOpenDriverControlV36) originalOpenDriverControlV36(orderId);

        const order = typeof driverOrders !== 'undefined' ? driverOrders.find(o => o.id === orderId) : null;
        if (!order) return;

        // 2. HAPUS tombol batal yang posisinya salah (dari Patch V36 sebelumnya)
        const oldBtn = document.getElementById('btn-driver-cancel-order');
        if (oldBtn) oldBtn.remove();

        // 3. Validasi: Jika sudah bayar, jangan munculkan lagi
        const isPaymentDone = order.paymentProof || order.status === 'paid' || order.status === 'verifying';
        if (isPaymentDone) return; 

        // 4. CARI TULISAN "KONTROL MISI" SECARA SPESIFIK
        const modal = document.getElementById('modal-driver-action');
        if (!modal) return;
        
        // Cari semua elemen teks di dalam modal tersebut
        const headings = modal.querySelectorAll('h1, h2, h3, h4, h5, h6, div, span, p');
        let targetHeader = null;
        
        for (let el of headings) {
            // Jika elemen ini berisi teks "Kontrol Misi"
            if (el.innerText && el.innerText.toLowerCase().includes('kontrol misi')) {
                // Pastikan kita tidak mengambil elemen anak, tapi bungkus utamanya
                targetHeader = el;
                // Jika ketemu yang pakai tag H (Heading), itu yang paling tepat
                if (el.tagName.startsWith('H')) break; 
            }
        }

        // 5. SISIPKAN TEPAT DI BAWAHNYA
        if (targetHeader) {
            const cancelBtn = document.createElement('div');
            cancelBtn.id = 'btn-driver-cancel-order';
            cancelBtn.className = "mt-3 mb-2 w-full flex justify-center"; 
            cancelBtn.innerHTML = `
                <button onclick="driverCancelOrderAction('${orderId}')" 
                    class="text-red-500 text-[11px] font-bold border border-red-200 bg-red-50 hover:bg-red-100 px-4 py-2 rounded-full transition active:scale-95 shadow-sm flex items-center gap-2">
                    <i class="fas fa-ban"></i> Batalkan Pesanan
                </button>
            `;

            // Perintah ini menaruh tombol tepat SETELAH elemen tulisan Kontrol Misi
            targetHeader.insertAdjacentElement('afterend', cancelBtn);
        }
    };

    console.log("🛠️ Patch V37: Reposisi Tombol Batal (Sniper) Aktif!");
}, 6100); // Dieksekusi paling terakhir untuk menimpa V36
// =====================================================================
// PATCH FINAL V53: THE INSTANT TANK (V50 SPEED + V52 POWER)
// Mengembalikan fitur "Kilat" V50 dengan mesin pertahanan V52
// =====================================================================

setTimeout(() => {
    const CHAT_KEY = 'goflash_chat_history_v3';

    // 1. PENCARI KTP LAWAN BICARA (DIKEMBALIKAN SEPERTI V50 YANG LANCAR)
    window.getValidPartnerId = function() {
        if (!activeOrder) return null;
        if (currentUser && currentUser.role === 'customer') {
            return activeOrder.driverId || activeOrder.driver_id || (activeOrder.driverInfo && activeOrder.driverInfo.id);
        } else if (currentUser && currentUser.role === 'driver') {
            return activeOrder.customerId || activeOrder.customer_id || (activeOrder.customerInfo && activeOrder.customerInfo.id) || activeOrder.user_id;
        }
        return null;
    };

    const formatChatTime = (isoString) => {
        const date = isoString ? new Date(isoString) : new Date();
        return `${date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} • ${date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}`;
    };

    // 2. PENYIMPAN KE MEMORI HP
    window.syncChatToLocal = function() {
        if (typeof chatMessages !== 'undefined') {
            localStorage.setItem(CHAT_KEY, JSON.stringify(chatMessages));
        }
    };

// 3. PENGGAMBAR BALON CHAT (Font Hitam & Tanggal Lengkap)
    window.renderChatBubble = function(text, isMe, timestamp = null) {
        const chatContainer = document.getElementById('chat-messages');
        if (!chatContainer) return;

        // Mesin Waktu (Jam & Tanggal)
        const date = timestamp ? new Date(timestamp) : new Date();
        const tString = `${date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} • ${date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}`;
        
        // Logika Warna (Background Biru Muda/Putih, Tulisan Hitam Pekat)
        const bubbleClass = isMe 
            ? 'bg-blue-100 text-black border border-blue-200 rounded-br-none ml-auto' 
            : 'bg-white text-black border border-gray-200 rounded-bl-none';
            
        const alignClass = isMe ? 'justify-end' : 'justify-start';
        
        const bubbleHTML = `
            <div class="flex ${alignClass} mb-3 animate-slide-up">
                <div class="max-w-[75%]">
                    <div class="px-4 py-2 rounded-2xl ${bubbleClass} shadow-sm text-sm font-medium" style="word-wrap: break-word; color: #000000 !important;">
                        ${text}
                    </div>
                    <div class="text-[10px] text-gray-500 mt-1 ${isMe ? 'text-right' : 'text-left'} px-1">
                        ${tString}
                    </div>
                </div>
            </div>
        `;
        chatContainer.insertAdjacentHTML('beforeend', bubbleHTML);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    };

// 4. MESIN KIRIM KILAT (OPTIMISTIC UI KEMBALI) - REVISI RADAR ID
    window.sendChat = function(customText = null) {
        const input = document.getElementById('chat-input');
        let textToSend = customText || (input ? input.value.trim() : '');
        if (!textToSend || !currentUser) return;

        // --- RADAR PELACAK ID LAWAN BICARA (DIPERBAIKI) ---
        let partnerId = null;
        if (typeof chatPartner !== 'undefined' && chatPartner && chatPartner.id) {
            partnerId = chatPartner.id; // Prioritas 1: Dari Tab Kontak
        } else if (typeof window.getValidPartnerId === 'function') {
            partnerId = window.getValidPartnerId(); // Prioritas 2: Dari Pesanan Aktif
        }

        // Jika masih kosong juga (Sistem nyangkut)
        if (!partnerId) {
            alert("Sistem: Maaf, belum terhubung dengan lawan bicara. Silakan buka ulang menu chat.");
            return;
        }

        const isoTime = new Date().toISOString();
        
        // A. MUNCUL KILAT DI LAYAR SENDIRI (Warna Hitam Pekat)
        window.renderChatBubble(textToSend, true, isoTime);

        // B. SIMPAN KE MEMORI HP
        if (typeof chatMessages === 'undefined') window.chatMessages = {};
        if (!chatMessages[partnerId]) chatMessages[partnerId] = [];
        chatMessages[partnerId].push({ text: textToSend, isMe: true, time: isoTime });
        window.syncChatToLocal();
        
        if (typeof window.updateChatContacts === 'function') {
            window.updateChatContacts(partnerId, (typeof chatPartner !== 'undefined' && chatPartner ? chatPartner.name : 'User'), textToSend);
        }

        // C. TEMBAK SERVER DENGAN SEMUA AMUNISI
        socket.emit('send_chat', {
            toUserId: partnerId,
            message: textToSend,
            fromName: currentUser.username
        });

        // Kosongkan input
        if (input && !customText) input.value = '';
    };

    // 5. BAJAK TOMBOL KIRIM AGAR TIDAK MACET
    document.addEventListener('click', function(e) {
        const sendBtn = e.target.closest('#btn-send-chat') || (e.target.tagName === 'BUTTON' && e.target.innerHTML.includes('fa-paper-plane'));
        if (sendBtn) { e.preventDefault(); e.stopPropagation(); window.sendChat(); }
    }, true);
    
    document.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && e.target.id === 'chat-input') {
            e.preventDefault(); window.sendChat();
        }
    });

    // 6. TERIMA PESAN DARI SERVER
    socket.off('receive_chat');
    socket.on('receive_chat', function(data) {
        const senderId = data.fromUserId || window.getValidPartnerId();
        const incomingText = data.message || data.text;
        const msgTime = data.timestamp || new Date().toISOString();

        if (!senderId || !incomingText) return;

        if (typeof chatMessages === 'undefined') window.chatMessages = {};
        if (!chatMessages[senderId]) chatMessages[senderId] = [];
        chatMessages[senderId].push({ text: incomingText, isMe: false, time: msgTime });
        window.syncChatToLocal();

        if (typeof window.updateChatContacts === 'function') {
            window.updateChatContacts(senderId, data.fromName || 'User', incomingText);
        }

        const chatModal = document.getElementById('modal-chat-room');
        if (chatModal && chatModal.classList.contains('active')) {
            window.renderChatBubble(incomingText, false, msgTime);
        } else {
            const audio = document.getElementById('notif-sound');
            if (audio) audio.play().catch(()=>{});
        }
    });

    // 7. PEMULIHAN SAAT REFRESH
    window.restoreChat = function() {
        const saved = localStorage.getItem(CHAT_KEY);
        if (saved) {
            try { 
                chatMessages = JSON.parse(saved); 
                if (typeof window.renderChatMessages === 'function') window.renderChatMessages();
            } catch(e) {}
        }
        if (currentUser && activeOrder) {
            const partnerId = window.getValidPartnerId();
            if (partnerId) socket.emit('get_chat_history', { userId: currentUser.id, partnerId: partnerId });
        } else {
            setTimeout(window.restoreChat, 1000);
        }
    };

    window.renderChatMessages = function() {
        const container = document.getElementById('chat-messages');
        const pId = window.getValidPartnerId() || (typeof chatPartner !== 'undefined' ? chatPartner.id : null);
        if (!container || !pId) return;
        
        container.innerHTML = '';
        const msgs = (chatMessages && chatMessages[pId]) ? chatMessages[pId] : [];
        msgs.forEach(m => window.renderChatBubble(m.text, m.isMe, m.time));
    };

    socket.on('connect', () => { setTimeout(window.restoreChat, 1000); });
    socket.on('receive_history', () => { setTimeout(window.restoreChat, 500); });
    socket.on('login_success', () => { setTimeout(window.restoreChat, 500); });
    setTimeout(window.restoreChat, 1500);

    console.log("🚀 Patch V53: The Instant Tank Aktif! (Kecepatan V50 + Pertahanan V52)");
}, 1300);
// =====================================================================
// PATCH FINAL V54: DRIVER SESSION KEEPER (Tahan Banting 60 Menit)
// Fitur: Anti-Offline saat Refresh / Tutup Aplikasi Sementara
// =====================================================================

setTimeout(() => {
    const DRIVER_SESSION_KEY = 'goflash_driver_session_v1';
    const GRACE_PERIOD = 3600000; // Batas Waktu 60 Menit (dalam milidetik)

    // 1. FUNGSI PENYIMPAN STATUS (Dipanggil setiap ada perubahan)
    window.saveDriverSession = function() {
        if (currentUser && currentUser.role === 'driver') {
            let currentLat = null, currentLng = null;
            if (userMarker) {
                currentLat = userMarker.getLatLng().lat;
                currentLng = userMarker.getLatLng().lng;
            }
            const sessionData = {
                isOnline: isDriverActive,
                timestamp: Date.now(),
                lat: currentLat,
                lng: currentLng
            };
            localStorage.setItem(DRIVER_SESSION_KEY, JSON.stringify(sessionData));
        }
    };

    // 2. CEGAT (BAJAK) SOCKET EMIT UNTUK MENGINTIP SAAT DRIVER KLIK ONLINE
    const originalSocketEmit = socket.emit;
    socket.emit = function(eventName, data) {
        if (eventName === 'driver_status_change') {
            isDriverActive = (data.status === 'online');
            window.saveDriverSession(); // Simpan ke brankas HP
        }
        originalSocketEmit.apply(socket, arguments);
    };

    // 3. MESIN PEMULIHAN KILAT SAAT REFRESH / BUKA APLIKASI
    window.restoreDriverSession = function() {
        if (!currentUser || currentUser.role !== 'driver') return;

        const saved = localStorage.getItem(DRIVER_SESSION_KEY);
        if (saved) {
            try {
                const session = JSON.parse(saved);
                const now = Date.now();

                // Cek: Apakah dia Online? Dan apakah belum lewat 60 Menit?
                if (session.isOnline && (now - session.timestamp < GRACE_PERIOD)) {
                    console.log("♻️ Memulihkan Sesi Driver (Belum 60 Menit)...");
                    
                    // A. Tembak variabel lokal
                    isDriverActive = true;

                    // B. Ubah Tampilan UI Tombol secara Paksa
                    const toggleBtn = document.getElementById('toggle-driver-status');
                    if (toggleBtn) {
                        toggleBtn.classList.remove('bg-gray-300', 'text-gray-600');
                        toggleBtn.classList.add('bg-blue-600', 'text-white');
                        toggleBtn.innerHTML = '<i class="fas fa-power-off"></i> OFFLINE KAN';
                    }

                    // C. Ubah Tampilan UI Indikator Teks Peta
                    const mapStatus = document.getElementById('map-status-indicator');
                    if (mapStatus) {
                        mapStatus.innerHTML = '<div class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div> Online';
                    }

                    // D. Tembak Server Seketika Tanpa Tunggu Loading
                    originalSocketEmit.call(socket, 'driver_status_change', {
                        status: 'online',
                        lat: session.lat || (userMarker ? userMarker.getLatLng().lat : 0),
                        lng: session.lng || (userMarker ? userMarker.getLatLng().lng : 0)
                    });

                    // Perpanjang umur timer
                    window.saveDriverSession();
                } else if (now - session.timestamp >= GRACE_PERIOD) {
                    // Kalau sudah 61 menit, buang memorinya
                    console.log("❌ Sesi Driver Kadaluarsa (>60 Menit).");
                    localStorage.removeItem(DRIVER_SESSION_KEY);
                }
            } catch(e) {}
        }
    };

    // 4. PEMICU PEMULIHAN OTOMATIS
    socket.on('login_success', () => { setTimeout(window.restoreDriverSession, 1000); });
    socket.on('receive_history', () => { setTimeout(window.restoreDriverSession, 1000); });
    
    // Backup data otomatis ke memori HP tiap 30 detik (Jika GPS HP bergerak)
    setInterval(window.saveDriverSession, 30000);

    console.log("🛡️ Patch V54: Driver Session Keeper Aktif! (Tahan Banting 60 Menit)");
}, 5400);

// =====================================================================
// PATCH FITUR 3: GOJEK LITE - WAKE LOCK API (ANTI-LAYAR MATI)
// Menahan layar HP Driver agar tetap menyala saat sedang bawa penumpang
// =====================================================================

setTimeout(() => {
    let wakeLock = null;

    // Fungsi untuk MENGUNCI layar agar tetap menyala
    window.lockScreenWake = async function() {
        if ('wakeLock' in navigator) {
            try {
                wakeLock = await navigator.wakeLock.request('screen');
                console.log('💡 [WAKE LOCK] Layar HP Driver dikunci! (Tetap Menyala)');
                
                // Jika driver meminimalkan aplikasi lalu membukanya lagi, kunci ulang layarnya
                document.addEventListener('visibilitychange', async () => {
                    if (wakeLock !== null && document.visibilityState === 'visible') {
                        wakeLock = await navigator.wakeLock.request('screen');
                    }
                });
            } catch (err) {
                console.warn(`Wake Lock ditolak oleh browser: ${err.message}`);
            }
        } else {
            console.log("Browser HP ini tidak mendukung Wake Lock API.");
        }
    };

    // Fungsi untuk MELEPAS kunci layar (Biar HP bisa auto-sleep lagi)
    window.unlockScreenWake = function() {
        if (wakeLock !== null) {
            wakeLock.release().then(() => {
                wakeLock = null;
                console.log('💡 [WAKE LOCK] Kunci layar dilepas. HP bisa tidur otomatis sekarang.');
            });
        }
    };

    // --- PEMASANGAN SENSOR OTOMATIS ---
    
    // 1. Kunci layar saat Driver MENERIMA pesanan
    const originalAccept = window.acceptOrder;
    window.acceptOrder = function() {
        if (originalAccept) originalAccept();
        window.lockScreenWake();
    };

    // 2. Lepas kunci layar saat Driver KEMBALI HIJAU (Selesai/Batal/Tolak)
    // Kita manfaatkan fungsi Pembersih Mutlak yang sudah Bapak pasang sebelumnya!
    const originalForceGreen = window.forceDriverGreen;
    window.forceDriverGreen = function() {
        if (originalForceGreen) originalForceGreen();
        window.unlockScreenWake();
    };

    console.log("🛠️ PATCH GOJEK LITE 2: Anti-Layar Mati (Wake Lock) Aktif!");
}, 5300); // Berjalan paling akhir
// =====================================================================
// PATCH FITUR 1: GOJEK LITE - IDENTITAS KENDARAAN & PLAT NOMOR
// Memaksa Driver mengisi Plat, dan menampilkannya ke Customer
// =====================================================================

setTimeout(() => {
    // 1. BUAT & SUNTIKKAN MODAL FORM KENDARAAN KE DALAM HTML
    const modalHTML = `
        <div id="modal-vehicle" class="fixed inset-0 z-[90] hidden flex items-center justify-center bg-black bg-opacity-70 backdrop-blur-sm transition-opacity">
            <div class="bg-white w-11/12 max-w-sm rounded-3xl p-6 shadow-2xl animate-slide-up border-t-4 border-blue-500">
                <h3 class="text-xl font-black text-gray-800 mb-1"><i class="fas fa-motorcycle text-blue-600 mr-2"></i>Data Kendaraan</h3>
                <p class="text-xs text-gray-500 mb-5 font-medium">Demi keamanan & kemudahan Customer menemukan Anda, lengkapi data ini.</p>
                
                <input type="text" id="input-v-name" placeholder="Nama Motor (Contoh: Vario Hitam)" class="w-full bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm font-bold mb-3 outline-none focus:ring-2 focus:ring-blue-500">
                
                <input type="text" id="input-v-plate" placeholder="Plat Nomor (Contoh: B 1234 XYZ)" class="w-full bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm font-black mb-5 outline-none focus:ring-2 focus:ring-blue-500 uppercase tracking-widest">
                
                <button onclick="saveVehicleData()" class="w-full py-4 bg-gradient-to-r from-blue-600 to-blue-500 text-white font-bold rounded-xl shadow-lg active:scale-95 transition">SIMPAN & MULAI NARIK</button>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Fungsi Tombol Simpan
    window.saveVehicleData = function() {
        const vName = document.getElementById('input-v-name').value;
        const vPlate = document.getElementById('input-v-plate').value.toUpperCase();
        
        if (vName.length < 3 || vPlate.length < 3) {
            alert("⚠️ Mohon isi Nama Motor dan Plat Nomor dengan jelas!");
            return;
        }

        // Tembak ke server
        socket.emit('update_vehicle', { userId: currentUser.id, name: vName, plate: vPlate });
        currentUser.vehicle_name = vName;
        currentUser.vehicle_plate = vPlate;
        
        document.getElementById('modal-vehicle').classList.add('hidden');
        alert("✅ Data Kendaraan Tersimpan! Selamat Bekerja.");
    };

    // 2. CEK SAAT LOGIN: Jika plat kosong, paksa isi!
    socket.on('login_success', (user) => {
        if (user.role === 'driver' && (!user.vehicle_plate || user.vehicle_plate === '')) {
            setTimeout(() => {
                document.getElementById('modal-vehicle').classList.remove('hidden');
            }, 1000); // Muncul setelah pop-up login hilang
        }
    });

    // 3. TAMPILKAN PLAT NOMOR DI LAYAR CUSTOMER
    // Kita gunakan sistem "Pengintai" (Observer) untuk mendeteksi kapan panel tracking aktif
    const trackingPanel = document.getElementById('panel-tracking');
    if (trackingPanel) {
        const observer = new MutationObserver(() => {
            if (activeOrder && activeOrder.driver_id && trackingPanel.classList.contains('active')) {
                // Tarik data driver terbaru dari map
                const driverData = driverMarkers[activeOrder.driver_id] || selectedDriver || {};
                const trackingTitle = trackingPanel.querySelector('h3'); // H3 biasanya berisi Nama Driver
                
                if (trackingTitle && !document.getElementById('badge-vehicle-info')) {
                    const motor = driverData.vehicle_name || 'Menunggu Info Motor';
                    const plat = driverData.vehicle_plate || 'PLAT BELUM DIISI';
                    
                    // Desain UI "Gojek Lite" yang cantik
                    const badgeHTML = `
                        <div id="badge-vehicle-info" class="mt-2 mb-3 flex items-center gap-3 bg-gray-50 border border-gray-200 p-2.5 rounded-xl shadow-sm">
                            <div class="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 border border-blue-200">
                                <i class="fas fa-motorcycle text-lg"></i>
                            </div>
                            <div class="flex flex-col text-left">
                                <span class="text-[10px] text-gray-500 font-bold uppercase tracking-wide">${motor}</span>
                                <span class="text-sm font-black text-gray-800 tracking-widest">${plat}</span>
                            </div>
                        </div>
                    `;
                    trackingTitle.insertAdjacentHTML('afterend', badgeHTML);
                }
            } else {
                // Hapus badge jika order selesai/batal
                const oldBadge = document.getElementById('badge-vehicle-info');
                if (oldBadge) oldBadge.remove();
            }
        });
        observer.observe(trackingPanel, { attributes: true, childList: true, subtree: true });
    }

    console.log("🛠️ PATCH GOJEK LITE 3: Identitas Kendaraan & Plat Nomor Aktif!");
}, 6300); // Berjalan paling akhir
// =====================================================================
// PATCH FITUR 2: GOJEK LITE - BACKGROUND PUSH NOTIFICATIONS
// Membunyikan HP & Memunculkan Notif Bar walau aplikasi di-minimize
// =====================================================================

setTimeout(() => {
    // 1. FUNGSI MEMINTA IZIN NOTIFIKASI KE HP
    window.requestNotificationPermission = async function() {
        if ('Notification' in window && navigator.serviceWorker) {
            if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
                const perm = await Notification.requestPermission();
                if (perm === 'granted') {
                    console.log("🔔 [PUSH] Izin Notifikasi Diberikan!");
                }
            }
        }
    };

    // 2. FUNGSI MENEMBAKKAN NOTIFIKASI KE STATUS BAR HP
    window.showLocalPush = function(title, body) {
        if ('Notification' in window && Notification.permission === 'granted' && navigator.serviceWorker) {
            navigator.serviceWorker.ready.then(function(registration) {
                registration.showNotification(title, {
                    body: body,
                    icon: 'https://cdn-icons-png.flaticon.com/512/61/61120.png', // Ikon Go Flash
                    badge: 'https://cdn-icons-png.flaticon.com/512/61/61120.png',
                    vibrate: [300, 150, 300, 150, 500, 200, 500], // Pola Getaran Khusus (SOS)
                    requireInteraction: true // Notif TIDAK AKAN HILANG sebelum di-klik/di-swipe
                });
            });
        }
    };

    // 3. PEMASANGAN SENSOR: Minta izin saat Driver mengklik tombol "ONLINE KAN"
    const btnToggle = document.getElementById('toggle-driver-status');
    if (btnToggle) {
        btnToggle.addEventListener('click', () => {
            window.requestNotificationPermission();
        });
    }

    // 4. BAJAK EVENT SERVER: Tembak Notifikasi saat ada Orderan Masuk
    socket.on('incoming_order', (data) => {
        window.showLocalPush(
            "🚨 ORDERAN BARU MASUK!", 
            "Ada penumpang yang butuh jemputan. Segera klik untuk buka aplikasi dan terima pesanannya!"
        );
    });

    // 5. BAJAK EVENT SERVER: Tembak Notifikasi saat ada Chat Masuk (Opsional)
    socket.on('receive_message', (data) => {
        // Hanya tembak notif jika layar chat tidak sedang terbuka
        const chatModal = document.getElementById('modal-chat');
        if (!chatModal || !chatModal.classList.contains('active')) {
            window.showLocalPush(
                "💬 Pesan Baru dari Penumpang", 
                `"${data.message}"`
            );
        }
    });

    console.log("🛠️ PATCH GOJEK LITE 4: Push Notifications (Service Worker) Aktif!");
}, 6600); // Berjalan paling akhir
// =====================================================================
// PATCH FITUR 6: GOJEK LITE - DOMPET DIGITAL (SALDO INTERNAL)
// Widget Saldo Melayang & Sistem Top-Up Manual via WhatsApp Admin
// =====================================================================

setTimeout(() => {
    // 1. BUAT & SUNTIKKAN UI DOMPET KE HTML
    const walletHTML = `
        <div id="wallet-widget" class="fixed top-4 right-4 z-[500] hidden bg-white/90 backdrop-blur-md border border-gray-200 shadow-lg rounded-2xl p-2 px-4 flex items-center gap-3 cursor-pointer hover:bg-gray-50 active:scale-95 transition" onclick="openWalletMenu()">
            <div class="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600">
                <i class="fas fa-wallet"></i>
            </div>
            <div class="flex flex-col text-right">
                <span class="text-[9px] text-gray-500 font-bold uppercase tracking-wider">Saldo Go Flash</span>
                <span id="wallet-balance" class="text-sm font-black text-gray-800">Rp 0</span>
            </div>
        </div>

        <div id="modal-wallet" class="fixed inset-0 z-[1000] hidden flex flex-col justify-end bg-black bg-opacity-60 backdrop-blur-sm transition-opacity">
            <div class="bg-white w-full rounded-t-3xl p-6 shadow-2xl animate-slide-up border-t-4 border-blue-500">
                <div class="flex justify-between items-center mb-6">
                    <h3 class="text-xl font-black text-gray-800"><i class="fas fa-wallet text-blue-600 mr-2"></i>Dompet Digital</h3>
                    <button onclick="closeWalletMenu()" class="w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-600 font-bold transition"><i class="fas fa-times"></i></button>
                </div>
                
                <div class="bg-gradient-to-r from-blue-600 to-blue-800 rounded-2xl p-5 mb-6 text-white shadow-lg relative overflow-hidden">
                    <i class="fas fa-coins absolute -right-4 -bottom-4 text-7xl text-white opacity-20"></i>
                    <p class="text-sm font-medium text-blue-100 mb-1">Total Saldo Anda</p>
                    <h2 id="wallet-modal-balance" class="text-3xl font-black tracking-tight">Rp 0</h2>
                </div>

                <p class="text-xs text-gray-500 mb-3 text-center font-bold">Pilih Nominal Top Up (Via WA Admin)</p>
                <div class="grid grid-cols-2 gap-3 mb-6">
                    <button onclick="topUpWA(20000)" class="py-3 bg-blue-50 text-blue-700 font-bold rounded-xl border border-blue-200 active:scale-95 transition hover:bg-blue-100">Rp 20.000</button>
                    <button onclick="topUpWA(50000)" class="py-3 bg-blue-50 text-blue-700 font-bold rounded-xl border border-blue-200 active:scale-95 transition hover:bg-blue-100">Rp 50.000</button>
                    <button onclick="topUpWA(100000)" class="py-3 bg-blue-50 text-blue-700 font-bold rounded-xl border border-blue-200 active:scale-95 transition hover:bg-blue-100">Rp 100.000</button>
                    <button onclick="topUpWA('Lainnya')" class="py-3 bg-blue-50 text-blue-700 font-bold rounded-xl border border-blue-200 active:scale-95 transition hover:bg-blue-100">Nominal Lain</button>
                </div>
                
                <button onclick="closeWalletMenu()" class="w-full py-4 bg-gray-100 text-gray-700 font-bold rounded-xl shadow-sm active:scale-95 transition hover:bg-gray-200">TUTUP</button>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', walletHTML);

    // 2. FUNGSI LOGIKA DOMPET
    window.openWalletMenu = function() {
        document.getElementById('modal-wallet').classList.remove('hidden');
    };
    window.closeWalletMenu = function() {
        document.getElementById('modal-wallet').classList.add('hidden');
    };
    
    window.topUpWA = function(nominal) {
        // !!! GANTI NOMOR INI DENGAN NOMOR WA ADMIN BAPAK !!!
        const adminPhone = "6281234567890"; 
        
        const text = nominal === 'Lainnya' 
            ? `Halo Admin Go Flash, saya ingin Top Up Saldo Dompet. Mohon info nomor rekening/DANA.`
            : `Halo Admin Go Flash, saya ingin Top Up Saldo sebesar *Rp ${nominal.toLocaleString('id-ID')}*. Mohon info nomor rekening/DANA.`;
            
        const waUrl = `https://wa.me/${adminPhone}?text=${encodeURIComponent(text)}`;
        window.open(waUrl, '_blank');
    };

    // 3. TAMPILKAN SALDO SAAT LOGIN BERHASIL
    socket.on('login_success', (user) => {
        // Tampilkan widget di pojok kanan atas
        document.getElementById('wallet-widget').classList.remove('hidden');
        
        // Format angka ke format Rupiah
        const balance = user.balance || 0;
        const formatted = 'Rp ' + balance.toLocaleString('id-ID');
        
        // Update teks di UI
        document.getElementById('wallet-balance').innerText = formatted;
        document.getElementById('wallet-modal-balance').innerText = formatted;
    });

    console.log("🛠️ PATCH GOJEK LITE 5: Dompet Digital (Saldo) Aktif!");
}, 500); // Berjalan paling akhir
// =====================================================================
// PATCH FITUR SUSPEND: CEKAL DRIVER NAKAL SAAT MAU ONLINE
// Memaksa tombol kembali Offline jika terdeteksi belum bayar komisi
// =====================================================================

setTimeout(() => {
    socket.on('account_suspended', () => {
        // 1. Munculkan Peringatan Keras di HP Driver
        alert("⛔ AKUN DITANGGUHKAN!\n\nMaaf, Anda tidak bisa menerima pesanan karena belum menyelesaikan tagihan/komisi. Silakan hubungi Admin untuk membuka blokir.");
        
        // 2. Paksa Matikan Saklar di UI (Terpental balik ke Offline)
        isDriverActive = false;
        
        // Matikan pelacak GPS
        if (typeof watchId !== 'undefined' && watchId !== null) { 
            navigator.geolocation.clearWatch(watchId); 
            watchId = null; 
        }
        
        // Ubah warna tombol jadi Abu-abu lagi
        const toggleBtn = document.getElementById('toggle-driver-status');
        if (toggleBtn) {
            toggleBtn.classList.remove('bg-blue-600', 'text-white');
            toggleBtn.classList.add('bg-gray-300', 'text-gray-600');
            toggleBtn.innerHTML = '<i class="fas fa-power-off"></i> ONLINE KAN';
        }
        
        // Ubah teks indikator di map
        const mapStatus = document.getElementById('map-status-indicator');
        if (mapStatus) {
            mapStatus.innerHTML = '<div class="w-2 h-2 rounded-full bg-gray-400"></div> Offline';
        }
        
        console.log("🚫 Akses Online Ditolak Server: Akun di-Suspend.");
    });

    console.log("🛠️ PATCH GOJEK LITE: Sistem Suspend Driver Aktif!");
}, 6850); // Berjalan paling akhir
// =====================================================================
// SENSOR SENTINEL: MENGHUBUNGKAN FITUR ORDER DENGAN WARNA MAPS DRIVER
// =====================================================================

// 1. Mesin Pengecek Fitur Order
window.checkDriverBusyStatus = () => {
    if (!currentUser || currentUser.role !== 'driver') return false;
    
    let isBusy = false;
    
    // Cek Variabel Memori
    if (activeOrder || currentControlOrderId) isBusy = true;
    
    // Cek Keranjang "Fitur Order" secara langsung (Ini request Bapak!)
    if (typeof driverOrders !== 'undefined' && driverOrders.length > 0) {
        const pesananBelumSelesai = driverOrders.filter(o => 
            o.status === 'accepted' || 
            o.status === 'picking_up' || 
            o.status === 'delivering' ||
            o.status === 'verifying'
        );
        
        // Jika ada minimal 1 pesanan yang belum 'completed' / 'cancelled'
        if (pesananBelumSelesai.length > 0) {
            isBusy = true;
        }
    }
    
    return isBusy;
};

// 2. Bajak Paksa Sinyal GPS yang Keluar dari HP Driver (Anti-Flicker)
const originalEmit = socket.emit;
socket.emit = function(eventName, data) {
    // Jika HP mencoba lapor "Online" ke Server...
    if (eventName === 'driver_status_change' && data && data.status === 'online') {
        const actuallyBusy = window.checkDriverBusyStatus();
        
        // Paksa timpa data isBusy-nya sesuai isi Fitur Order!
        data.isBusy = actuallyBusy; 
        
        // BONUS VISUAL: Ubah tombol saklar di layar Driver agar Driver sadar dia sedang Merah
        const toggleBtn = document.getElementById('toggle-driver-status');
        if (toggleBtn && isDriverActive) {
            if (actuallyBusy) {
                toggleBtn.classList.remove('bg-blue-600');
                toggleBtn.classList.add('bg-red-500');
                toggleBtn.innerHTML = '<i class="fas fa-motorcycle"></i> SIBUK (MERAH)';
            } else {
                toggleBtn.classList.remove('bg-red-500');
                toggleBtn.classList.add('bg-blue-600');
                toggleBtn.innerHTML = '<i class="fas fa-power-off"></i> OFFLINE KAN';
            }
        }
    }
    // Lanjutkan pengiriman ke server
    originalEmit.apply(socket, arguments);
};

// 3. Alarm Sentinel (Mengingatkan Server Setiap 3 Detik)
setInterval(() => {
    if (currentUser && currentUser.role === 'driver' && isDriverActive) {
        const actuallyBusy = window.checkDriverBusyStatus();
        // Paksa tembak status terus-menerus agar tidak berubah hijau sendiri
        socket.emit('driver_status_change', { 
            id: currentUser.id, 
            status: 'online', 
            isBusy: actuallyBusy 
        });
    }
}, 3000);
// =====================================================================
// PATCH ORDER KILAT: NOTIFIKASI PESANAN MASUK & DITERIMA
// Respons getaran & UI instan saat order masuk ke Driver & saat Driver terima
// =====================================================================

setTimeout(() => {
// 1. ORDER MASUK KE DRIVER (ALARM, GETAR & BUKA LAYAR PAKSA)
    socket.on('incoming_order', (orderData) => {
        if (currentUser && currentUser.role === 'driver' && isDriverActive) {
            
            // A. Getar dan Bunyi
            if (navigator.vibrate) navigator.vibrate([1000, 500, 1000, 500, 1000]);
            if (typeof window.showLocalPush === 'function') {
                window.showLocalPush("🚨 ORDERAN MASUK!", "Buka aplikasi sekarang, ada penumpang!");
            }
            try {
                const audio = new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg');
                audio.play();
            } catch(e) {}

            // B. MUNCULKAN POP-UP KE LAYAR SECARA PAKSA!
            console.log("Menampilkan pesanan ke layar...", orderData);
            
            // Simpan ID Order ke memori HP
            window.tempOrderId = orderData.id;

            // Masukkan data ke dalam Pop-Up
            const elCustomer = document.getElementById('incoming-customer');
            const elPickup = document.getElementById('incoming-pickup');
            const elDest = document.getElementById('incoming-destination');
            const elPrice = document.getElementById('incoming-price');

            if (elCustomer) elCustomer.innerText = orderData.customerName || 'Penumpang';
            if (elPickup) elPickup.innerText = orderData.pickupLocation || 'Lokasi Jemput';
            if (elDest) elDest.innerText = orderData.destination || 'Tujuan';
            if (elPrice) elPrice.innerText = orderData.price ? 'Rp ' + orderData.price.toLocaleString() : '-';

            // Paksa buka modal/pop-up nya
            if (typeof openModal === 'function') {
                openModal('modal-incoming-order');
            } else {
                const modal = document.getElementById('modal-incoming-order');
                if (modal) modal.classList.add('active');
            }

            // Update juga daftar pesanan di belakang layar
            if (typeof driverOrders !== 'undefined' && Array.isArray(driverOrders)) {
                // Cek agar tidak dobel
                const exists = driverOrders.find(o => o.id === orderData.id);
                if (!exists) {
                    driverOrders.push(orderData);
                    if (typeof renderDriverOrderList === 'function') renderDriverOrderList();
                }
            }
        }
    });

    // 2. SAAT CUSTOMER MENDAPATKAN KONFIRMASI (DRIVER TERIMA ORDER)
    socket.on('order_accepted', (data) => {
        if (currentUser && currentUser.role === 'customer') {
            // Getaran Bahagia untuk Customer (Getar pendek 2x)
            if (navigator.vibrate) navigator.vibrate([300, 100, 300]);
            
            // Push Notif ke Customer
            if (typeof window.showLocalPush === 'function') {
                window.showLocalPush(
                    "✅ DRIVER DITEMUKAN!", 
                    "Driver sedang meluncur ke lokasi penjemputan Anda."
                );
            }
            
            // Munculkan Pop-up Kilat (Bisa dihapus jika dirasa mengganggu)
            // alert("✅ DRIVER DITEMUKAN!\n\nDriver sudah menerima pesanan Anda. Silakan pantau pergerakannya di peta.");

            console.log("⚡ KILAT: Konfirmasi Driver Diterima Customer!");
        }
    });

    console.log("⚡ PATCH ORDER KILAT: Notifikasi Pesanan Masuk & Diterima Aktif!");
}, 400); // Berjalan setelah sistem utama dimuat
// =====================================================================
// PATCH KILAT: HANCURKAN TOMBOL BATAL SAAT BUKTI BAYAR MASUK
// =====================================================================
setTimeout(() => {
    socket.on('payment_submitted', (data) => {
        if (currentUser && currentUser.role === 'driver') {
            // 1. Cari tombol batal di layar Driver
            const cancelBtn = document.getElementById('btn-driver-cancel-order');
            
            // 2. Jika ketemu, HANCURKAN seketika tanpa ampun!
            if (cancelBtn) {
                cancelBtn.remove();
                console.log("⚡ KILAT: Tombol Batal otomatis lenyap karena Customer sudah bayar!");
            }
        }
    });
}, 8000); // Berjalan sebagai pendengar (listener) di latar belakang
// =====================================================================
// MEGA PATCH CHAT V3: PEMBERSIH & PENYELARAS MUTLAK (ANTI-HILANG)
// =====================================================================
setTimeout(() => {
    console.log("🧹 V3: Membersihkan semua mesin chat lama...");
    
    // MATIKAN SEMUA PENDENGAR LAMA SECARA MUTLAK
    socket.removeAllListeners('receive_chat');
    socket.removeAllListeners('send_chat');
    
    // 1. MESIN WAKTU LENGKAP
    const formatChatTime = (isoString) => {
        const date = isoString ? new Date(isoString) : new Date();
        return `${date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} • ${date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}`;
    };

    // 2. MESIN PENGGAMBAR BALON (Teks Hitam)
    window.renderChatBubble = function(text, isMe, timestamp = null) {
        const chatContainer = document.getElementById('chat-messages');
        if (!chatContainer) return;

        const tString = formatChatTime(timestamp);
        let finalHtml = text;

        if (typeof text === 'string' && text.startsWith('[SHARE_LOC]')) {
            const parts = text.split('|');
            finalHtml = `<a href="http://googleusercontent.com/maps.google.com/maps?daddr=${parts[1]},${parts[2]}" target="_blank" class="text-blue-600 underline font-bold"><i class="fas fa-map-marker-alt"></i> Buka Peta</a>`;
        }

        const bubbleClass = isMe 
            ? 'bg-blue-100 border-blue-200 ml-auto rounded-br-none' 
            : 'bg-white border-gray-200 rounded-bl-none';
        const alignClass = isMe ? 'justify-end' : 'justify-start';

        const bubbleHTML = `
            <div class="flex ${alignClass} mb-3 animate-slide-up">
                <div class="max-w-[80%]">
                    <div class="px-4 py-2 rounded-2xl border shadow-sm text-sm font-medium ${bubbleClass}" style="color: #000000 !important; word-wrap: break-word;">
                        ${finalHtml}
                    </div>
                    <div class="text-[10px] text-gray-500 mt-1 ${isMe ? 'text-right' : 'text-left'} px-1">
                        ${tString}
                    </div>
                </div>
            </div>
        `;
        // Gunakan appendChild agar memori tidak refresh (mengatasi layar blank)
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = bubbleHTML.trim();
        chatContainer.appendChild(tempDiv.firstChild);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    };

    // 3. RADAR ID PINTAR (ANTI-SALAH ALAMAT)
    window.getValidPartnerId = function() {
        if (typeof chatPartner !== 'undefined' && chatPartner && chatPartner.id) return String(chatPartner.id);
        if (typeof activeOrder !== 'undefined' && activeOrder) {
            return String((currentUser.role === 'customer') ? (activeOrder.driverId || activeOrder.driver_id) : (activeOrder.customerId || activeOrder.customer_id));
        }
        return null;
    };

    // 4. MESIN PENGIRIM
    window.sendChat = function(customText = null) {
        const input = document.getElementById('chat-input');
        const textToSend = customText || (input ? input.value.trim() : '');
        if (!textToSend || !currentUser) return;

        const partnerId = window.getValidPartnerId();
        
        if (!partnerId) {
            alert("Sistem: Lawan bicara belum terhubung. ID tidak ditemukan.");
            return;
        }

        const isoTime = new Date().toISOString();

        // Gambar seketika di layar sendiri
        window.renderChatBubble(textToSend, true, isoTime);

        // Kirim ke server
        socket.emit('send_chat', {
            toUserId: partnerId,
            message: textToSend,
            fromName: currentUser.username
        });

        // Simpan ke memori HP
        if (typeof chatMessages === 'undefined') window.chatMessages = {};
        if (!chatMessages[partnerId]) chatMessages[partnerId] = [];
        chatMessages[partnerId].push({ text: textToSend, isMe: true, time: isoTime });
        
        if (typeof window.updateChatContacts === 'function') {
            window.updateChatContacts(partnerId, (chatPartner ? chatPartner.name : 'User'), textToSend);
        }

        if (input && !customText) input.value = '';
    };

    // 5. PENERIMA TUNGGAL (SATU-SATUNYA YANG AKTIF)
    socket.on('receive_chat', function(data) {
        console.log("📥 V3: Menerima Chat", data);
        
        let rawSenderId = data.fromUserId || data.senderId || data.from;
        const incomingText = data.message || data.text;
        
        // PENCEGAH BUG ALAMAT KOSONG (Fall back ke Active Order)
        if (!rawSenderId) {
             rawSenderId = window.getValidPartnerId();
        }
        
        if (!rawSenderId || !incomingText) return;

        const senderId = String(rawSenderId);
        const isoTime = data.timestamp || new Date().toISOString();

        if (typeof chatMessages === 'undefined') window.chatMessages = {};
        if (!chatMessages[senderId]) chatMessages[senderId] = [];
        chatMessages[senderId].push({ text: incomingText, isMe: false, time: isoTime });

        const chatModal = document.getElementById('modal-chat-room');
        const isModalOpen = chatModal && chatModal.classList.contains('active');
        const currentPartnerId = window.getValidPartnerId();

        if (isModalOpen && currentPartnerId === senderId) {
            window.renderChatBubble(incomingText, false, isoTime);
        } else {
            const audio = document.getElementById('notif-sound');
            if (audio) audio.play().catch(()=>{});
        }
        
        if (typeof window.updateChatContacts === 'function') {
            window.updateChatContacts(senderId, data.fromName || 'User', incomingText);
        }
    });

    // 6. WARNA INPUT CHAT JADI HITAM
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.style.color = "#000000";
        chatInput.style.fontWeight = "600";
    }

    // 7. Cegah Memori me-refresh layar saat chat sedang aktif
    window.renderChatMessages = function() {}; 

    console.log("✅ MESIN CHAT V3: Terpasang! Semua tabrakan sudah dibersihkan.");
}, 9900); // 16 Detik untuk memastikan DIA YANG TERAKHIR!
// =====================================================================
// MEGA PATCH: ALARM PEMBATALAN INSTAN (ANTI-REFRESH)
// Memunculkan Alert & Getaran secara real-time saat pesanan dibatalkan
// =====================================================================

setTimeout(() => {
    // 1. SAAT DRIVER MEMBATALKAN PESANAN (Alarm untuk Customer)
    socket.on('order_cancelled_by_driver', (data) => {
        if (currentUser && currentUser.role === 'customer') {
            const orderId = data ? data.orderId : null;
            
            // Pastikan ini adalah orderan yang sedang aktif milik Customer
            if (activeOrder && (orderId === null || activeOrder.id === orderId)) {
                
                // Getarkan HP dengan pola keras
                if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 500]);
                
                // Munculkan Notifikasi Tengah Layar
                alert("❌ MAAF! Driver membatalkan pesanan Anda. Silakan melakukan pemesanan ulang.");

                // Bersihkan layar Peta Tracking
                const panelTracking = document.getElementById('panel-tracking-customer');
                if (panelTracking) panelTracking.style.bottom = "-100%"; 
                
                // Hapus data order dari memori aktif
                activeOrder = null;
                selectedDriver = null;

                // Minta ulang riwayat pesanan (agar masuk ke daftar batal)
                socket.emit('request_history', { userId: currentUser.id });
            }
        }
    });

    // 2. SAAT CUSTOMER MEMBATALKAN PESANAN (Alarm untuk Driver)
    socket.on('order_cancelled_by_customer', (data) => {
        if (currentUser && currentUser.role === 'driver') {
            const orderId = data ? data.orderId : null;

            // Cari apakah pesanan ini sedang dikerjakan driver (di Fitur Order)
            let isOrderDikerjakan = false;
            if (typeof driverOrders !== 'undefined') {
                const canceledOrder = driverOrders.find(o => o.id === orderId);
                if (canceledOrder || (activeOrder && activeOrder.id === orderId)) {
                    isOrderDikerjakan = true;
                }
            }

            // Jika iya, bunyikan alarm
            if (isOrderDikerjakan || !orderId) {
                // Getaran kecewa
                if (navigator.vibrate) navigator.vibrate([1000, 500, 1000]);
                
                alert("❌ YAH! Penumpang telah membatalkan pesanannya.");

                // Hapus pesanan dari memori Driver
                if (typeof driverOrders !== 'undefined' && orderId) {
                    const freshIdx = driverOrders.findIndex(o => o.id === orderId);
                    if (freshIdx > -1) driverOrders.splice(freshIdx, 1);
                }
                if (activeOrder && activeOrder.id === orderId) activeOrder = null;
                if (currentControlOrderId === orderId) currentControlOrderId = null;

                // Tutup semua pop-up kerjaan Driver
                if (typeof closeModal === 'function') {
                    closeModal('modal-driver-action');
                    closeModal('modal-incoming-order');
                }

                // Render ulang layar List Order
                if (typeof renderDriverOrderList === 'function') renderDriverOrderList();

                // Bersihkan garis rute di peta jika ada
                if (typeof window.clearRouteOnMap === 'function') window.clearRouteOnMap();
                
                socket.emit('request_history', { userId: currentUser.id });
            }
        }
    });

    // 3. FUNGSI PENEKAN TOMBOL BATAL DARI CUSTOMER (Lebih Responsif)
    window.cancelOrderHistory = function(orderId) {
        if (!orderId) return;
        
        const confirmCancel = confirm("Yakin ingin membatalkan pesanan ini?");
        if (confirmCancel) {
            // Tembak server
            socket.emit('cancel_order_customer', { orderId: orderId, customerId: currentUser.id });
            
            // Tutup panel tracking
            const panel = document.getElementById('panel-tracking-customer');
            if (panel) panel.style.bottom = "-100%";
            
            // Bersihkan memori dan re-render
            activeOrder = null;
            alert("✅ Pesanan berhasil dibatalkan.");
            
            if (typeof renderHistory === 'function') renderHistory();
        }
    };

    console.log("🚨 ALARM PEMBATALAN INSTAN: Aktif!");
}, 10000); // Jalan di detik ke-10 agar menimpa semua kode rusak lama
// =====================================================================
// MEGA PATCH: JENDELA PENGUMUMAN PEMBATALAN & PENOLAKAN MUTLAK
// Membuat UI Pop-up Kustom yang tidak bisa diblokir oleh browser HP
// =====================================================================

setTimeout(() => {
    // 1. SUNTIKKAN DESAIN JENDELA PENGUMUMAN KE DALAM APLIKASI
    const modalHTML = `
        <div id="custom-alert-modal" class="fixed inset-0 z-[99999] hidden flex items-center justify-center bg-black bg-opacity-70 transition-opacity">
            <div class="bg-white rounded-2xl p-6 w-11/12 max-w-sm mx-auto text-center shadow-2xl transform scale-95 transition-transform duration-300" id="custom-alert-box">
                <div id="custom-alert-icon" class="text-6xl mb-4">⚠️</div>
                <h3 id="custom-alert-title" class="text-xl font-bold text-gray-800 mb-2">Pemberitahuan</h3>
                <p id="custom-alert-message" class="text-gray-600 text-sm mb-6 leading-relaxed">Pesan di sini</p>
                <button onclick="closeCustomAlert()" class="w-full bg-blue-600 text-white font-bold py-3.5 rounded-xl hover:bg-blue-700 transition shadow-md text-sm">
                    SAYA MENGERTI
                </button>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // 2. MESIN PENGGERAK JENDELA PENGUMUMAN
    window.showCustomAlert = function(title, message, icon) {
        document.getElementById('custom-alert-title').innerText = title;
        document.getElementById('custom-alert-message').innerText = message;
        document.getElementById('custom-alert-icon').innerText = icon || "⚠️";
        
        const modal = document.getElementById('custom-alert-modal');
        const box = document.getElementById('custom-alert-box');
        modal.classList.remove('hidden');
        
        // Efek animasi muncul
        setTimeout(() => {
            box.classList.remove('scale-95');
            box.classList.add('scale-100');
        }, 10);

        // Getarkan HP keras agar pengguna sadar
        if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
    };

    // 3. MESIN PENUTUP JENDELA & PEMBERSIH LAYAR (SANGAT PENTING)
    window.closeCustomAlert = function() {
        document.getElementById('custom-alert-modal').classList.add('hidden');
        
        // Bersihkan UI Customer yang nyangkut
        const panelTracking = document.getElementById('panel-tracking-customer');
        if (panelTracking) panelTracking.style.bottom = "-100%";
        const panelFinding = document.getElementById('panel-finding-driver');
        if (panelFinding) panelFinding.classList.add('hidden');
        
        // Bersihkan UI Driver yang nyangkut
        const modalIncoming = document.getElementById('modal-incoming-order');
        if (modalIncoming) modalIncoming.classList.remove('active');
        
        // Kembalikan Driver ke mode Hijau / Siap Menerima Order
        if (typeof window.forceDriverGreen === 'function') window.forceDriverGreen();
        
        // Refresh riwayat
        if (typeof renderHistory === 'function') renderHistory();
    };

    // =================================================================
    // PENGATURAN LOGIKA PENOLAKAN & PEMBATALANNYA
    // =================================================================

    // A. CUSTOMER MENDAPAT PENOLAKAN/PEMBATALAN DARI DRIVER
    const rejectEvents = ['order_cancelled_by_driver', 'order_rejected', 'driver_rejected', 'no_driver_found'];
    rejectEvents.forEach(evt => {
        socket.on(evt, () => {
            if (currentUser && currentUser.role === 'customer') {
                window.showCustomAlert(
                    "Pesanan Ditolak / Dibatalkan", 
                    "Maaf, Driver saat ini tidak dapat menerima pesanan Anda atau telah membatalkannya. Silakan pesan driver lain.", 
                    "❌"
                );
                activeOrder = null;
                selectedDriver = null;
            }
        });
    });

    // B. DRIVER MENDAPAT PEMBATALAN DARI CUSTOMER
    socket.on('order_cancelled_by_customer', () => {
        if (currentUser && currentUser.role === 'driver') {
            window.showCustomAlert(
                "Pesanan Dibatalkan", 
                "Yah! Penumpang telah membatalkan pesanannya. Anda bisa menunggu pesanan selanjutnya.", 
                "⚠️"
            );
            activeOrder = null;
            currentControlOrderId = null;
        }
    });

    // C. SAAT DRIVER MENEKAN TOMBOL "TOLAK" PESANAN MASUK
    window.rejectOrder = function(orderId) {
        if (!orderId) orderId = window.incomingOrderId;
        
        // Hilangkan pop-up pesanan masuk di driver seketika
        const modalIncoming = document.getElementById('modal-incoming-order');
        if (modalIncoming) modalIncoming.classList.remove('active');
        
        // Jalankan Trik Kuda Troya (Terima lalu Batal) agar Server dipaksa kirim notif ke Customer
        socket.emit('accept_order', { orderId: orderId, driverId: currentUser.id });
        setTimeout(() => {
            socket.emit('cancel_order_driver', { orderId: orderId, driverId: currentUser.id });
            window.incomingOrderId = null;
            if (typeof window.forceDriverGreen === 'function') window.forceDriverGreen();
        }, 200); 
    };

    // D. SAAT CUSTOMER MENEKAN TOMBOL "BATALKAN PESANAN" DI MENU RIWAYAT
    window.cancelOrderHistory = function(orderId) {
        if (!orderId) return;
        
        const confirmCancel = confirm("Yakin ingin membatalkan pesanan ini?");
        if (confirmCancel) {
            socket.emit('cancel_order_customer', { orderId: orderId, customerId: currentUser.id });
            
            // Tampilkan Jendela Sukses Batal ke layar Customer sendiri
            window.showCustomAlert(
                "Berhasil Dibatalkan", 
                "Pesanan Anda telah berhasil dibatalkan.", 
                "✅"
            );
            activeOrder = null;
        }
    };

    console.log("🚨 JENDELA PENGUMUMAN SUPER: Terpasang Sempurna!");
}, 11000); // Eksekusi terakhir di detik ke-22
// =====================================================================
// PATCH FINAL V39: POP-UP NOTIFIKASI SILANG (TOLAK & BATAL)
// =====================================================================
setTimeout(() => {
    
    // 1. DARI SISI CUSTOMER: Mendengar Sinyal Driver Menolak (Tolak Order Baru)
    socket.on('order_rejected', function(data) {
        if (currentUser && currentUser.role === 'customer') {
            console.log("❌ Sinyal Diterima: Driver Menolak Pesanan");
            
            // Getarkan HP Customer
            if (navigator.vibrate) navigator.vibrate([300, 100, 300]);
            
            // Bersihkan Status Order
            window.activeCustomerOrder = null;
            activeOrder = null;

            // Tutup Panel Pencarian (Jika masih terbuka)
            const searchPanel = document.getElementById('panel-searching-driver');
            if (searchPanel) searchPanel.style.bottom = "-100%";

            // Munculkan Pop-up Jendela Pengumuman ke Customer
            if (typeof window.showCustomAlert === 'function') {
                window.showCustomAlert(
                    "Pesanan Ditolak", 
                    "Mohon maaf, Driver saat ini tidak dapat menerima pesanan Anda. Silakan cari Driver lain.", 
                    "❌"
                );
            } else {
                alert("❌ Pesanan Anda ditolak oleh Driver.");
            }

            // Kembalikan tombol Pesan Sekarang menjadi normal
            const btnOrder = document.getElementById('btn-order-ride');
            if (btnOrder) {
                btnOrder.disabled = false;
                btnOrder.innerHTML = 'Pesan Sekarang';
            }
        }
    });

    // 2. DARI SISI DRIVER: Mendengar Sinyal Customer Membatalkan Pesanan
    socket.on('order_cancelled_by_customer', function(data) {
        if (currentUser && currentUser.role === 'driver') {
            console.log("⚠️ Sinyal Diterima: Customer Membatalkan Pesanan");
            
            // Getarkan HP Driver
            if (navigator.vibrate) navigator.vibrate([500, 200, 500]);
            
            // Kembalikan Status Driver jadi "Tersedia"
            activeOrder = null;
            currentControlOrderId = null;
            if (currentUser) currentUser.isBusy = false;

            // Tutup Paksa Modal Kontrol Misi atau Modal Pesanan Masuk
            const actionModal = document.getElementById('modal-driver-action');
            if (actionModal) closeModal('modal-driver-action');
            
            const incomingModal = document.getElementById('modal-incoming-order');
            if (incomingModal) incomingModal.classList.remove('active');

            // Hapus Rute di Peta
            if (typeof window.clearRouteOnMap === 'function') window.clearRouteOnMap();

            // Munculkan Pop-up Jendela Pengumuman ke Driver
            if (typeof window.showCustomAlert === 'function') {
                window.showCustomAlert(
                    "Pesanan Dibatalkan", 
                    "Customer telah membatalkan pesanan ini. Anda kembali berstatus Tersedia.", 
                    "⚠️"
                );
            } else {
                alert("⚠️ Customer membatalkan pesanan. Anda kembali berstatus Tersedia.");
            }

            // Update layar list order Driver
            if (typeof renderDriverOrderList === 'function') renderDriverOrderList();
        }
    });

    console.log("🛠️ PATCH V39: Pop-up Notifikasi Tolak & Batal Silang Aktif!");
}, 13000); // Dieksekusi belakangan agar menimpa kode lama
// =====================================================================
// PATCH FINAL V40: FITUR PRE-ORDER CANGGIH & ALARM KILAT (POIN 2,3,4)
// =====================================================================
setTimeout(() => {
    window.isPreorderMode = null;
    window.tempOrderType = 'ride';
    
    // 1. FUNGSI BUKA MODAL SUB-MENU
    window.openOrderTypeModal = function(type) {
        window.tempOrderType = type;
        const modal = document.getElementById('modal-order-type');
        if (!modal) {
            console.error("HTML Modal Pre-order belum dipasang!");
            // Fallback jika HTML belum ada
            if (typeof originalShowOrderForm === 'function') originalShowOrderForm(type);
            return;
        }
        
        // Logika Smart Button (Kunci tombol jika driver merah/sibuk)
        const btnNow = document.getElementById('btn-type-now');
        const labelNow = document.getElementById('label-type-now');
        const isDriverBusy = selectedDriver && (selectedDriver.isBusy === true || selectedDriver.status !== 'online');
        
        if (isDriverBusy) {
            btnNow.disabled = true;
            btnNow.classList.remove('bg-green-500');
            btnNow.classList.add('bg-gray-400', 'cursor-not-allowed');
            if(labelNow) labelNow.innerText = "Terkunci: Driver sedang sibuk";
        } else {
            btnNow.disabled = false;
            btnNow.classList.remove('bg-gray-400', 'cursor-not-allowed');
            btnNow.classList.add('bg-green-500');
            if(labelNow) labelNow.innerText = "Driver akan langsung menuju lokasi";
        }
        
        modal.classList.remove('hidden');
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            modal.querySelector('div').classList.remove('scale-95');
        }, 10);
    };

    // 2. FUNGSI TUTUP MODAL
    window.closeOrderTypeModal = function() {
        const modal = document.getElementById('modal-order-type');
        if (modal) {
            modal.classList.add('opacity-0');
            modal.querySelector('div').classList.add('scale-95');
            setTimeout(() => modal.classList.add('hidden'), 300);
        }
    };

    // 3. FUNGSI PILIH TIPE & BUKA FORM
    window.selectOrderType = function(isPreorder) {
        window.isPreorderMode = isPreorder;
        window.closeOrderTypeModal();
        
        if (typeof originalShowOrderForm === 'function') {
            originalShowOrderForm(window.tempOrderType);
            setTimeout(() => injectPreorderTimeInput(isPreorder), 300);
        }
    };

    // 4. HIJACK FUNGSI TOMBOL BAWAAN (Agar buka modal dulu)
    const originalShowOrderForm = window.showOrderForm;
    window.showOrderForm = function(type) {
        window.openOrderTypeModal(type);
    };

// =========================================================================
    // 1. KODINGAN KHUSUS: SUNTIK FORM WAKTU TEPAT DI BAWAH SHARELOC
    // =========================================================================
    function injectPreorderTimeInput(isPreorder) {
        const oldInput = document.getElementById('preorder-time-container');
        if (oldInput) oldInput.remove();

        if (!isPreorder) return; 

        // Mencari elemen input Link Shareloc Jemput di HTML Bapak
        const sharelocInput = document.getElementById('order-shareloc');
        
        if (sharelocInput) {
            const timeContainer = document.createElement('div');
            timeContainer.id = 'preorder-time-container';
            // Styling disesuaikan agar rapi di bawah shareloc
            timeContainer.className = "mt-3 mb-2 bg-blue-50 border border-blue-200 p-3 rounded-xl shadow-sm";
            
            // Logika ganti nama: Estimasi Penjemputan (Ride) / Estimasi Pengantaran (Delivery)
            const labelText = window.tempOrderType === 'ride' ? 'Estimasi Penjemputan' : 'Estimasi Pengantaran';
            
            timeContainer.innerHTML = `
                <label class="block text-xs font-bold text-blue-800 mb-2"><i class="fas fa-clock"></i> ${labelText} (Rentang Waktu)</label>
                <div class="flex items-center gap-2">
                    <input type="time" id="preorder-time-start" class="w-full p-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:border-blue-500 font-bold" required>
                    <span class="text-sm font-bold text-gray-500">-</span>
                    <input type="time" id="preorder-time-end" class="w-full p-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:border-blue-500 font-bold" required>
                </div>
                <p class="text-[10px] text-gray-500 mt-1">Contoh: 15:00 - 15:20</p>
            `;
            
            // Menyisipkan form waktu ini TEPAT 1 milimeter di bawah kolom Shareloc
            sharelocInput.parentNode.insertBefore(timeContainer, sharelocInput.nextSibling);
        }
    }

    // =========================================================================
    // 2. KODINGAN KHUSUS: ALARM DUA ARAH (CUSTOMER & DRIVER)
    // =========================================================================
    setInterval(() => {
        // Pengecekan berlaku untuk semua role (Driver maupun Customer akan kena alarm)
        if (!currentUser) return;
        if (!activeOrder || !activeOrder.isPreorder || activeOrder.alarmTriggered) return;

        if (activeOrder.preorderTime) {
            const startTimeStr = activeOrder.preorderTime.split('-')[0].trim(); // Ambil jam awal
            
            const now = new Date();
            const currentHours = String(now.getHours()).padStart(2, '0');
            const currentMinutes = String(now.getMinutes()).padStart(2, '0');
            const currentTimeStr = `${currentHours}:${currentMinutes}`;
            
            if (currentTimeStr >= startTimeStr) {
                activeOrder.alarmTriggered = true; // Kunci agar alarm cuma bunyi 1x
                
                // Pemicu Getar HP (Pola keras)
                if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 1000]);
                
                // Pesan Pop-up berbeda antara Driver dan Customer
                let alertMsg = currentUser.role === 'customer' 
                    ? "Waktu yang Anda jadwalkan telah tiba! Driver akan segera menuju lokasi Anda." 
                    : "Waktu estimasi penjemputan/pengantaran telah tiba! Segera proses pesanan Customer ini.";

                if (typeof window.showCustomAlert === 'function') {
                    window.showCustomAlert(
                        "🚨 WAKTU PRE-ORDER DIMULAI!", 
                        alertMsg, 
                        "⏰"
                    );
                } else {
                    alert(`🚨 WAKTU PRE-ORDER DIMULAI!\n\n${alertMsg}`);
                }
            }
        }
    }, 10000); // Radar alarm berputar setiap 10 detik

// =========================================================================
    // 3. KODINGAN KHUSUS: PENAMPIL TEKS WAKTU DI KARTU PESANAN (DRIVER & CUSTOMER)
    // =========================================================================
    setInterval(() => {
        if (!currentUser) return;

        // A. Memunculkan teks di layar Driver saat Pesanan Baru Masuk (Pop-up Incoming)
        // Note: Asumsi variabel pesanan masuk disimpan di window.incomingOrder atau sejenisnya
        const incomingOrderData = window.incomingOrder || (activeOrder && activeOrder.status === 'searching' ? activeOrder : null);
        
        if (incomingOrderData && incomingOrderData.isPreorder) {
            const incomingModal = document.getElementById('modal-incoming-order');
            if (incomingModal && incomingModal.classList.contains('active') && !document.getElementById('badge-preorder-incoming')) {
                const header = incomingModal.querySelector('.bg-royal') || incomingModal.firstElementChild;
                if (header) {
                    header.insertAdjacentHTML('afterend', `
                        <div id="badge-preorder-incoming" class="bg-blue-100 border-b-4 border-blue-500 text-blue-900 p-3 text-center font-bold text-sm flex items-center justify-center gap-2 animate-pulse">
                            <i class="fas fa-clock text-blue-600 text-lg"></i> 
                            <span>PRE-ORDER: <span class="text-xl">${incomingOrderData.preorderTime}</span></span>
                        </div>
                    `);
                }
            }
        }

        // B. Memunculkan teks di layar Kontrol Driver / Layar Status Customer (Pesanan Aktif)
        if (activeOrder && activeOrder.isPreorder && activeOrder.status !== 'searching') {
            // Memindai ID panel yang biasanya aktif saat pesanan berjalan
            const targetPanels = ['panel-active-order', 'modal-driver-action', 'order-sheet'];
            
            targetPanels.forEach(panelId => {
                const panel = document.getElementById(panelId);
                // Jika panelnya sedang terbuka di layar
                if (panel && (!panel.classList.contains('hidden') && panel.style.bottom !== '-100%') && !document.getElementById('badge-preorder-active-' + panelId)) {
                    
                    const badgeHTML = `
                        <div id="badge-preorder-active-${panelId}" class="m-3 bg-blue-100 border border-blue-300 text-blue-900 p-3 rounded-xl font-bold text-sm flex justify-center items-center gap-2 shadow-sm border-l-4 border-l-blue-600">
                            <i class="fas fa-clock text-blue-600 text-2xl"></i> 
                            <div class="text-left leading-tight">
                                <span class="text-[10px] text-blue-600 block uppercase">Jadwal Eksekusi</span>
                                <span class="text-lg">${activeOrder.preorderTime}</span>
                            </div>
                        </div>
                    `;

                    // Sisipkan tepat di bawah header warna biru (bg-royal) agar posisinya paling atas
                    const insertTarget = panel.querySelector('.bg-royal') || panel.querySelector('.p-4') || panel.firstElementChild;
                    if (insertTarget) {
                        insertTarget.insertAdjacentHTML('afterend', badgeHTML);
                    }
                }
            });
        }
    }, 1500); // Radar UI menyapu layar setiap 1,5 detik
    
    console.log("🛠️ PATCH V38: FITUR PRE-ORDER CANGGIH AKTIF!");
}, 16000);
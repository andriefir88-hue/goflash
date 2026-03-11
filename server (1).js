const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

// --- INISIALISASI ---
const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());
app.use(express.static(__dirname));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- KONEKSI SUPABASE ---
const SUPABASE_URL = 'https://xkzeisdvmyfgjffnrcdi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhremVpc2R2bXlmZ2pmZm5yY2RpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2OTI1MzYsImV4cCI6MjA4NjI2ODUzNn0.udOS6XjaBsFGBrB5sClJoamIiG9rukUfQB1Wm7Adz6c';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- MEMORI SEMENTARA (RAM) ---
let drivers = {};   
let customers = {}; 
let activeOrders = {}; 
let otpStorage = {}; 

// --- CONFIG HARGA & LAYANAN (UPDATE LENGKAP: RIDE & DELIVERY) ---
const APP_CONFIG = {
    QRIS: { 
        NMID: "ID1026472381452A01", 
        NAME: "GO FLASH OFFICIAL",
        IMAGE: "qris.jpg" // Pastikan file gambar ini ada di folder project
    },
    PRICES: {
        // A. Kategori RIDE (Antar Jemput)
        RIDE: [
            { name: "Telang - Kampus", price: 5000 },
            { name: "Telang - Graha Bundaran", price: 10000 },
            { name: "Telang - Kamal", price: 15000 },
            { name: "Telang - Socah", price: 15000 },
            { name: "Telang - Pelabuhan Kamal", price: 15000 },
            { name: "Telang - Terminal Bangkalan", price: 25000 },
            { name: "Telang - Alang-alang", price: 25000 },
            { name: "Telang - Bkl Kota", price: 35000 },
            { name: "Telang - Tangkel", price: 35000 },
            { name: "Telang - Tanean Suramadu", price: 40000 },
            { name: "Telang - Nyebrang Suramadu", price: 50000 },
            { name: "Telang - Surabaya", price: 55000 },
            { name: "Telang - Sidoarjo", price: 80000 },
            { name: "Telang - Bandara Juanda", price: 100000 }
        ],
        // B. Kategori DELIVERY (Kirim Barang)
        DELIVERY: [
            { name: "1 Tempat", price: 5000 },
            { name: "2 Tempat", price: 7000 },
            { name: "3 Tempat", price: 9000 },
            { name: "1 Tempat + Parkir", price: 7000 },
            { name: "2 Tempat + 2 Kali Parkir", price: 14000 }
        ]
    }
};

// --- HELPER: MENGHITUNG JARAK (HAVERSINE FORMULA) ---
// Digunakan untuk mencari driver terdekat nanti (Sesi Optimization)
function getDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 9999; // Jauh sekali
    const R = 6371; // Radius bumi km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // Jarak dalam KM
}

// ==========================================
// 1. API SECTION
// ==========================================

app.get('/api/config', (req, res) => res.json(APP_CONFIG));

app.post('/api/auth/request-otp', async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.json({ success: false, message: "Nomor HP wajib diisi!" });
    const otpCode = Math.floor(1000 + Math.random() * 9000).toString();
    otpStorage[phone] = otpCode;
    console.log(`🔑 OTP [${phone}]: ${otpCode}`);
    return res.json({ success: true, message: "Kode OTP terkirim" });
});

app.post('/api/auth/verify-otp', async (req, res) => {
    const { action, username, phone, role, otp, vehicleModel, plate } = req.body;
    if (!otpStorage[phone] || otpStorage[phone] !== otp) return res.json({ success: false, message: "Kode OTP Sesuai!" });
    delete otpStorage[phone];

    try {
        let user;
        if (action === 'register') {
            const { data: existing } = await supabase.from('users').select('phone').eq('phone', phone).single();
            if (existing) return res.json({ success: false, message: "Nomor terdaftar! Login saja." });
            
            const newId = 'USR-' + Date.now();
            const { data, error } = await supabase.from('users').insert([{
                id: newId, username: username || "User", phone, role,
                accountStatus: (role === 'driver') ? 'pending' : 'active',
                vehicleModel: vehicleModel || "-", plate: plate || "-",
                serviceType: [], status: 'offline', isBusy: false, is_online: false
            }]).select().single();
            if (error) throw error;
            user = data;
        } else {
            const { data, error } = await supabase.from('users').select('*').eq('phone', phone).single();
            if (error || !data) return res.json({ success: false, message: "Nomor tidak ditemukan." });
            user = data;
        }
        return res.json({ success: true, data: user, warning: (user.role === 'driver' && user.accountStatus === 'pending') ? 'pending_approval' : null });
    } catch (e) { return res.json({ success: false, message: "Database Error: " + e.message }); }
});

app.post('/api/update_profile', async (req, res) => {
    const { id, username, vehicleModel, plate, photo } = req.body;
    if (!id) return res.json({ success: false, message: "ID User hilang." });
    try {
        let updates = { username }; 
        if (vehicleModel) updates.vehicleModel = vehicleModel;
        if (plate) updates.plate = plate;
        if (photo) updates.photo = photo; 
        const { data, error } = await supabase.from('users').update(updates).eq('id', id).select().single();
        if (error) throw error;
        if (data.role === 'driver' && drivers[id]) {
            Object.assign(drivers[id], updates);
            io.emit('driver_state_update', drivers[id]);
        } else if (customers[id]) {
            Object.assign(customers[id], updates);
        }
        res.json({ success: true, data: data });
    } catch (e) { res.json({ success: false, message: "Gagal Update." }); }
});

app.get('/approve', async (req, res) => {
    const phone = req.query.phone;
    await supabase.from('users').update({ accountStatus: 'active' }).eq('phone', phone);
    res.send(`<h1>✅ Driver Aktif.</h1>`);
});

// ==========================================
// 2. REALTIME ENGINE (ORDER LOGIC UPDATED)
// ==========================================
io.on('connection', (socket) => {
    
    // --- CONNECT ---
    socket.on('register_socket', async (userId) => {
        const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
        if (user) {
            await supabase.from('users').update({ socket_id: socket.id, is_online: true }).eq('id', userId);
            const userData = { ...user, socketId: socket.id };
            if (user.role === 'driver') {
                drivers[userId] = userData;
                console.log(`🟢 DRIVER ONLINE: ${user.username}`);
            } else {
                customers[userId] = userData;
                console.log(`🔵 CUSTOMER ONLINE: ${user.username}`);
                const activeDriversList = Object.values(drivers).filter(d => d.status === 'online');
                socket.emit('initial_drivers_data', activeDriversList);
            }
        }
    });

// ==========================================================
    // FITUR GOJEK LITE: UPDATE IDENTITAS KENDARAAN
    // ==========================================================
    socket.on('update_vehicle', async (data) => {
        try {
            // 1. Simpan permanen ke Supabase
            await supabase.from('users').update({
                vehicle_name: data.name,
                vehicle_plate: data.plate
            }).eq('id', data.userId);
            
            // 2. Simpan di memori RAM Server agar bisa dibaca Customer
            if (drivers[data.userId]) {
                drivers[data.userId].vehicle_name = data.name;
                drivers[data.userId].vehicle_plate = data.plate;
            }
            console.log(`🏍️ Info Kendaraan Diupdate: ${data.name} (${data.plate})`);
        } catch(e) { 
            console.error("Gagal update kendaraan:", e); 
        }
    });

    // --- DRIVER STATUS ---
    socket.on('driver_status_change', async (data) => {
        const driver = drivers[data.id];
        if (driver) {
            driver.status = data.status;
            driver.isBusy = data.isBusy;
            console.log(`🚨 Status Driver ${driver.username}: ${data.status}`);
            io.emit('driver_state_update', driver);
            await supabase.from('users').update({ status: data.status }).eq('id', data.id);
        }
    });

    // --- GPS ---
    socket.on('update_location', (data) => {
        const driver = drivers[data.id];
        if (driver) {
            driver.location = { lat: data.lat, lng: data.lng };
            driver.angle = data.angle;
            socket.broadcast.emit('driver_moved', driver);
        }
    });

    // --- ORDER SYSTEM (PEMBAHARUAN UTAMA) ---

    // 1. REQUEST ORDER
    socket.on('request_order', async (data) => {
        const orderId = 'ORD-' + Date.now();
        
        // Simpan ke RAM
        activeOrders[orderId] = { 
            ...data, 
            id: orderId, 
            status: 'searching',
            createdAt: new Date()
        };
        
        console.log(`📦 Order Masuk: ${data.serviceType} dari ${data.customerName}`);

        // Simpan ke DATABASE (Supabase) - History
        try {
            await supabase.from('orders').insert([{
                id: orderId,
                customer_id: data.customerId,
                pickup_location: data.pickupLocation,
                destination: data.destination,
                price: data.price,
                service_type: data.serviceType,
                status: 'searching'
            }]);
        } catch (e) { console.error("DB Save Error:", e); }
        
        // Cari Driver (Filter: Online, Tidak Sibuk, Punya Socket)
        // Di masa depan, filter jarak < 5km disini
        const availableDrivers = Object.values(drivers).filter(d => 
            d.status === 'online' && 
            !d.isBusy && 
            d.socketId
        );
        
        if(availableDrivers.length === 0) {
            // Beritahu customer kalau tidak ada driver
            socket.emit('order_failed', { message: "Maaf, tidak ada driver aktif saat ini." });
            return;
        }

        // Broadcast ke Driver
        availableDrivers.forEach(d => { 
            io.to(d.socketId).emit('incoming_order', activeOrders[orderId]); 
        });
    });

    // 1. REQUEST ORDER (LOGIKA BARU: PRE-ORDER DIAKTIFKAN)
    socket.on('request_order', async (data) => {
        const orderId = 'ORD-' + Date.now();
        
        // Simpan ke RAM
        activeOrders[orderId] = { 
            ...data, 
            id: orderId, 
            status: 'searching',
            createdAt: new Date()
        };
        
        console.log(`📦 Order Masuk: ${data.serviceType} | Pay: ${data.paymentMethod} | Target: ${data.targetDriverId || 'Acak'}`);

        // Simpan ke DATABASE (Supabase) - Update: Simpan paymentMethod
        try {
            await supabase.from('orders').insert([{
                id: orderId,
                customer_id: data.customerId,
                pickup_location: data.pickupLocation,
                destination: data.destination,
                price: data.price,
                service_type: data.serviceType,
                status: 'searching',
                payment_method: data.paymentMethod || 'cash', // Fitur QRIS: Simpan metode bayar
                notes: data.notes || '-'
            }]);
        } catch (e) { console.error("DB Save Error:", e); }
        
        // --- LOGIKA FILTER DRIVER (CORE UPDATE) ---
        let potentialDrivers = [];

        if (data.targetDriverId) {
            // SKENARIO A: PRE-ORDER (User pilih driver spesifik di Peta)
            const target = drivers[data.targetDriverId];
            
            // LOGIKA PRE-ORDER:
            // Kita IZINKAN order masuk meskipun driver sedang BUSY (isBusy=true)
            // Asalkan driver tersebut statusnya ONLINE.
            if (target && target.status === 'online') {
                potentialDrivers.push(target);
            }
        } else {
            // SKENARIO B: ORDER BIASA (Broadcast Acak)
            // Hanya cari driver yang ONLINE dan TIDAK SIBUK (Hijau)
            potentialDrivers = Object.values(drivers).filter(d => 
                d.status === 'online' && !d.isBusy && d.socketId
            );
        }
        
        if(potentialDrivers.length === 0) {
            socket.emit('order_failed', { message: "Maaf, driver tidak tersedia atau sedang offline." });
            return;
        }

        // Broadcast ke Driver (Termasuk yang Pre-Order)
        potentialDrivers.forEach(d => { 
            io.to(d.socketId).emit('incoming_order', activeOrders[orderId]); 
        });
    });

    // 2. ACCEPT ORDER (LOGIKA BARU: TRIGGER MODAL QRIS & STATUS DRIVER)
    socket.on('accept_order', async (data) => {
        const order = activeOrders[data.orderId];
        
        // Cek validitas
        if (!order) return;
        if (order.status !== 'searching') {
            socket.emit('order_failed', { message: "Telat! Order sudah diambil driver lain." });
            socket.emit('order_taken_by_other', { orderId: data.orderId });
            return;
        }

        // UPDATE DATABASE
    await supabase.from('orders').update({
        status: 'accepted',
        driver_id: data.driverId,
        // TAMBAHKAN BARIS INI AGAR WAKTU TERKUNCI PERMANEN:
        accepted_at: new Date().toISOString() 
    }).eq('id', data.orderId);
    
        // Kunci Order
        order.status = 'accepted';
        order.driverId = data.driverId;
        
        const driver = drivers[data.driverId];
        const cust = customers[order.customerId];

        if (driver) {
            // Update Status Driver jadi SIBUK (Merah)
            driver.isBusy = true;
            io.emit('driver_state_update', driver); // Broadcast ke Peta semua user
            order.driverInfo = driver; 

            // Update Database Driver
            await supabase.from('users').update({ isBusy: true }).eq('id', driver.id);
        }

        // Update Database Order
        await supabase.from('orders').update({ 
            driver_id: data.driverId, 
            status: 'accepted' 
        }).eq('id', data.orderId);

        // Notifikasi ke Customer (UPDATE: Sertakan paymentMethod untuk Client Logic)
        if (cust && cust.socketId) {
            io.to(cust.socketId).emit('order_accepted', {
                ...order,
                paymentMethod: order.paymentMethod // Client akan cek: if 'qris' -> showModal
            });
        }
        
        // Notifikasi ke Driver
        socket.emit('order_success_take', order);

        // Tutup modal driver lain
        socket.broadcast.emit('order_taken_by_other', { orderId: data.orderId });
        
        console.log(`✅ Order ${data.orderId} Accepted by ${driver.username} (Method: ${order.paymentMethod})`);
    });
    
    // --- SESI 1: TAMBAHAN LOGIKA PEMBAYARAN & MISI SELESAI ---

// A. CUSTOMER MENGIRIM BUKTI PEMBAYARAN (CASH/QRIS)
    socket.on('submit_payment', async (data) => {
        const { orderId, method, proofBase64 } = data;
        const order = activeOrders[orderId];

        if (order) {
            try {
                // 1. Update status di memori (RAM)
                order.payment_method = method;
                order.payment_proof = proofBase64;
                order.payment_status = 'pending_verification';

                // 2. LANGSUNG BERITAHU DRIVER SAAT ITU JUGA (BYPASS DATABASE)
                // Ini kunci utamanya agar foto tidak nyangkut menunggu loading Supabase
                const driver = drivers[order.driverId];
                if (driver && driver.socketId) {
                    io.to(driver.socketId).emit('payment_proof_received', {
                        orderId,
                        method,
                        proofBase64
                    });
                    console.log(`📸 Sinyal Bukti Bayar INSTAN terkirim ke Driver untuk Order: ${orderId}`);
                } else {
                    console.log(`⚠️ Driver untuk Order ${orderId} tidak ditemukan di memori atau sedang offline.`);
                }

                // 3. BARU UPDATE DATABASE (Jalan diam-diam di latar belakang)
                // Jadi misal database butuh waktu 5 detik untuk menyimpan foto, 
                // layar HP Driver sudah merespon di detik ke-1.
                await supabase.from('orders').update({
                    payment_method: method,
                    payment_proof: proofBase64,
                    payment_status: 'pending_verification' // Samakan dengan status di atas
                }).eq('id', orderId);

            } catch (err) {
                console.error("Terjadi masalah saat memproses bukti bayar:", err);
            }
        } else {
            console.log(`❌ Order ${orderId} tidak ditemukan di daftar pesanan aktif.`);
        }
    });

    // B. DRIVER MENGONFIRMASI PEMBAYARAN (TOMBOL 2)
    socket.on('confirm_payment', async (data) => {
        const order = activeOrders[data.orderId];
        if (order) {
            order.payment_status = 'verified';

            // Update Database
            await supabase.from('orders').update({ payment_status: 'verified' }).eq('id', data.orderId);

            // Kabari Customer: "Pembayaran Anda sudah diverifikasi oleh Driver"
            const cust = customers[order.customerId];
            if (cust && cust.socketId) {
                io.to(cust.socketId).emit('payment_verified', { orderId: data.orderId });
            }
            
            // Beritahu Driver bahwa dia sekarang bisa menekan tombol "Misi Selesai"
            socket.emit('payment_verified_success', { orderId: data.orderId });
            console.log(`✅ Pembayaran Order ${data.orderId} Diverifikasi.`);
        }
    });

// C. DRIVER MENYELESAIKAN MISI (KODE ANTI-MACET)
    socket.on('finish_mission', async (data) => {
        const orderId = data.orderId;
        if (!orderId) return;

        console.log(`Menerima sinyal misi selesai untuk Order: ${orderId}`);

        try {
            // 1. PAKSA UPDATE DATABASE LEBIH DULU (JANGAN TUNGGU RAM)
            await supabase.from('orders').update({ 
                status: 'completed', 
                payment_status: 'verified', // Paksa lunas juga
                finished_at: new Date().toISOString() 
            }).eq('id', orderId);

            // 2. TEMBAK SINYAL SAPU JAGAT KE SEMUA ORANG (Driver & Customer)
            // Ini akan memicu kode Sapu Jagat di app.js yang mengubah tombol jadi abu-abu
            io.emit('mission_ended', { orderId: orderId });

            // 3. BARU URUS RAM & DRIVER (Jika pesanan masih ada di memori)
            const order = activeOrders[orderId];
            if (order) {
                const driverId = order.driverId;
                const driver = drivers[driverId];

                if (driver) {
                    // Bebaskan Driver (Kembali Hijau di Peta)
                    driver.isBusy = false;
                    await supabase.from('users').update({ isBusy: false }).eq('id', driverId);
                    io.emit('driver_state_update', driver);
                }

                // Hapus dari memori aktif
                delete activeOrders[orderId];
            }
            
            console.log(`🏁 Misi Selesai. Database & UI berhasil diupdate.`);
        } catch (err) {
            console.error("Gagal menyelesaikan misi:", err);
        }
    });
    
// ==============================================================
    // CHAT SYSTEM ENTERPRISE (DATABASE-BACKED)
    // ==============================================================
    
    // 1. MINTA RIWAYAT CHAT (Dipanggil saat Web di-refresh)
    socket.on('get_chat_history', async (data) => {
        if (!data || !data.orderId) return;
        try {
            // Ambil semua pesan untuk order ini dari Supabase, urutkan dari yang terlama
            const { data: msgs, error } = await supabase
                .from('messages')
                .select('*')
                .eq('order_id', data.orderId)
                .order('created_at', { ascending: true });
                
            if (!error && msgs) {
                socket.emit('chat_history_data', msgs); // Kirim balik ke HP yang minta
            }
        } catch (e) { console.error("Gagal Tarik Histori:", e); }
    });

// ==============================================================
    // CHAT SYSTEM ENTERPRISE (DATABASE-BACKED & HISTORY 30 DAYS)
    // ==============================================================
    
    // 1. MINTA RIWAYAT CHAT (Dipanggil dari HP)
    socket.on('get_chat_history', async (data) => {
        try {
            if (!data.userId || !data.partnerId) return;

            // Hitung tanggal 30 hari yang lalu
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            // Tarik pesan antara User A dan User B selama 30 hari terakhir
            const { data: msgs, error } = await supabase
                .from('messages')
                .select('*')
                .or(`and(sender_id.eq.${data.userId},receiver_id.eq.${data.partnerId}),and(sender_id.eq.${data.partnerId},receiver_id.eq.${data.userId})`)
                .gte('created_at', thirtyDaysAgo.toISOString())
                .order('created_at', { ascending: true });

            if (!error && msgs) {
                socket.emit('chat_history_data', { partnerId: data.partnerId, messages: msgs });
            }
        } catch (e) { console.error("Gagal Tarik Histori:", e); }
    });

    // 2. TERIMA PESAN & SIMPAN KE DATABASE
    socket.on('send_chat', async (data) => {
        const target = Object.values({ ...drivers, ...customers }).find(u => u.id === data.toUserId);
        
        // Deteksi pengirim yang valid
        let senderId = null;
        const sender = Object.values({ ...drivers, ...customers }).find(u => u.socketId === socket.id);
        if (sender) senderId = sender.id;
        const finalSenderId = senderId || data.fromUserId;

        // A. Wajib Simpan ke Supabase agar riwayat tidak hilang!
        if (finalSenderId && data.toUserId && data.message) {
            try {
                await supabase.from('messages').insert([{
                    order_id: data.orderId || null,
                    sender_id: finalSenderId,
                    receiver_id: data.toUserId,
                    text: data.message
                }]);
            } catch (e) { console.error("Gagal Simpan Chat ke DB:", e); }
        }

        // B. Teruskan langsung ke HP Penerima (Jika dia sedang online)
        if (target && target.socketId) {
            io.to(target.socketId).emit('receive_chat', { 
                message: data.message, 
                fromName: data.fromName,
                fromUserId: finalSenderId,
                timestamp: new Date().toISOString() // Sertakan waktu server
            });
        }
    });

// --- FITUR BARU: MENGAMBIL RIWAYAT DARI RAM & DATABASE ---
    socket.on('request_history', async (data) => {
        const userId = data.userId;
        if (!userId) return;

        try {
            let historyOrders = [];

            // 1. CARI DI MEMORI RAM DULU (Untuk Pesanan Berlangsung)
            if (typeof activeOrders !== 'undefined') {
                for (const orderId in activeOrders) {
                    const order = activeOrders[orderId];
                    if (order.customerId === userId || order.driverId === userId) {
                        if(!order.created_at) order.created_at = new Date().toISOString();
                        historyOrders.push(order);
                    }
                }
            }

            // 2. CARI DI DATABASE SUPABASE (PERBAIKAN NAMA KOLOM)
            const sebulanLalu = new Date();
            sebulanLalu.setDate(sebulanLalu.getDate() - 30);

            const { data: dbOrders, error } = await supabase
                .from('orders')
                .select('*')
                // KUNCI PERBAIKAN: Gunakan garis bawah (customer_id dan driver_id)
                .or(`customer_id.eq.${userId},driver_id.eq.${userId}`) 
                .gte('created_at', sebulanLalu.toISOString())
                .order('created_at', { ascending: false })
                .limit(50);

            if (!error && dbOrders) {
                // Gabungkan data dari RAM dan Database
                const activeOrderIds = historyOrders.map(o => o.id);
                const filteredDbOrders = dbOrders.filter(o => !activeOrderIds.includes(o.id));
                historyOrders = [...historyOrders, ...filteredDbOrders];
            } else if (error) {
                console.error("Error DB Riwayat:", error.message); 
            }

            // 3. Urutkan dan Kirim
            historyOrders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            socket.emit('receive_history', historyOrders);

        } catch(e) {
            console.error("Gagal mengambil riwayat:", e);
        }
    });

// ==============================================================
// FITUR BARU: DRIVER MENOLAK / MEMBATALKAN PESANAN
// ==============================================================

// 0. CUSTOMER MEMBATALKAN PESANAN (BARU DITAMBAHKAN)
    socket.on('cancel_order_customer', async (data) => {
        console.log(`⚠️ Customer membatalkan pesanan: ${data.orderId}`);
        
        try {
            // Update Database agar resmi batal
            await supabase.from('orders').update({ status: 'cancelled' }).eq('id', data.orderId);
            
            const order = activeOrders[data.orderId];
            
            if (order && order.driverId) {
                // 1. Bebaskan Driver di RAM Server
                if (drivers[order.driverId]) {
                    drivers[order.driverId].isBusy = false;
                    // Update Peta: Ubah Driver jadi Hijau lagi
                    io.emit('driver_state_update', drivers[order.driverId]);
                }
                
                // 2. TEMBAK NOTIFIKASI KE HP DRIVER! (Ini yang memunculkan Pop-up)
                if (drivers[order.driverId] && drivers[order.driverId].socketId) {
                    io.to(drivers[order.driverId].socketId).emit('order_cancelled_by_customer', { orderId: data.orderId });
                } else {
                    // Jika socket ID spesifik gagal, broadcast ke semua (hanya driver terkait yang akan merespons di app.js)
                    socket.broadcast.emit('order_cancelled_by_customer', { orderId: data.orderId });
                }
            } else if (data.orderId) {
                 // Skenario jika pesanan dibatalkan sebelum ada driver yang menerima (masih 'searching')
                 socket.broadcast.emit('order_cancelled_by_customer', { orderId: data.orderId });
            }

            // Hapus pesanan dari memori Server (RAM)
            if (activeOrders[data.orderId]) {
                delete activeOrders[data.orderId];
            }
            
        } catch(e) { 
            console.error("Gagal proses batal dari Customer:", e); 
        }
    });

    // 1. Sinyal Tolak Biasa (Saat pesanan baru masuk)
    socket.on('reject_order', async (data) => {
        const order = activeOrders[data.orderId];
        if (order) {
            console.log(`❌ Driver ${data.driverId} menolak pesanan ${data.orderId}`);
            
            // Pantulkan sinyal penolakan ke Customer pemesan
            const cust = customers[order.customerId];
            if (cust && cust.socketId) {
                io.to(cust.socketId).emit('order_rejected', { orderId: data.orderId });
                io.to(cust.socketId).emit('no_driver_found', { orderId: data.orderId }); // Backup sinyal
            }
            
            // Kembalikan Driver ke status Standby/Tidak Sibuk
            const driver = drivers[data.driverId];
            if (driver) {
                driver.isBusy = false;
                io.emit('driver_state_update', driver);
            }
        }
    });

    // 2. Sinyal Batal Paksa (Saat Driver membatalkan paksa / Kuda Troya)
    socket.on('cancel_order_driver', async (data) => {
        const order = activeOrders[data.orderId];
        
        // Cek ID Customer. Jika ada di RAM, pakai. Jika tidak, cari di data yang dikirim
        let custIdToNotify = null;
        if (order) custIdToNotify = order.customerId;
        else if (data.customerId) custIdToNotify = data.customerId;

        console.log(`🚨 Driver membatalkan paksa pesanan ${data.orderId}`);

        try {
            // Update Database agar resmi batal
            await supabase.from('orders').update({ status: 'cancelled' }).eq('id', data.orderId);
            
            // Hapus dari memori Server (RAM)
            if (activeOrders[data.orderId]) {
                delete activeOrders[data.orderId];
            }

            // Tembak alarm langsung ke HP Customer
            if (custIdToNotify) {
                const cust = customers[custIdToNotify];
                if (cust && cust.socketId) {
                    io.to(cust.socketId).emit('order_cancelled_by_driver', { orderId: data.orderId });
                    io.to(cust.socketId).emit('order_rejected', { orderId: data.orderId }); // Sinyal sapu jagat
                }
            } else {
                // Jika ID Customer gagal dilacak, tembak sinyal ke semua orang (Broadcast)
                socket.broadcast.emit('order_cancelled_by_driver', { orderId: data.orderId });
            }

            // Bebaskan Driver
            const driver = drivers[data.driverId];
            if (driver) {
                driver.isBusy = false;
                await supabase.from('users').update({ isBusy: false }).eq('id', data.driverId);
                io.emit('driver_state_update', driver);
            }
        } catch(e) {
            console.error("Gagal proses batal paksa dari driver:", e);
        }
    });

// =====================================================================
// KABEL PEMANTUL NOTIFIKASI DRIVER -> CUSTOMER
// =====================================================================

    // 1. Saat Driver Menolak Pesanan Masuk (Status: Menunggu Konfirmasi)
    socket.on('reject_order', async (data) => {
        console.log(`❌ Driver ${data.driverId} menolak pesanan ${data.orderId}`);
        const order = activeOrders[data.orderId];
        
        // Pantulkan ke Customer
        let custId = order ? order.customerId : data.customerId;
        if (custId && customers[custId] && customers[custId].socketId) {
            io.to(customers[custId].socketId).emit('order_rejected', { orderId: data.orderId });
        } else {
            // Jika ID terputus, tembak ke semua (hanya customer bersangkutan yang merespons di app.js)
            socket.broadcast.emit('order_rejected', { orderId: data.orderId });
        }
        
        // Bebaskan Driver
        if (drivers[data.driverId]) {
            drivers[data.driverId].isBusy = false;
            io.emit('driver_state_update', drivers[data.driverId]);
        }
    });

    // 2. Saat Driver Membatalkan Pesanan Secara Paksa (Status: Diproses)
    // Mendengarkan 2 versi nama sinyal untuk keamanan
    ['cancel_order_driver', 'cancel_order_by_driver'].forEach(eventName => {
        socket.on(eventName, async (data) => {
            console.log(`🚨 Driver membatalkan pesanan: ${data.orderId}`);
            
            try {
                // Update Database agar resmi batal
                await supabase.from('orders').update({ status: 'cancelled' }).eq('id', data.orderId);
                
                // Cari ID Customer
                const order = activeOrders[data.orderId];
                let custId = order ? order.customerId : data.customerId;

                // Pantulkan Notifikasi ke HP Customer Seketika Itu Juga!
                if (custId && customers[custId] && customers[custId].socketId) {
                    io.to(customers[custId].socketId).emit('order_cancelled_by_driver', { orderId: data.orderId });
                } else {
                    socket.broadcast.emit('order_cancelled_by_driver', { orderId: data.orderId });
                }

                // Bersihkan memori server
                if (activeOrders[data.orderId]) delete activeOrders[data.orderId];

                // Bebaskan Driver
                if (drivers[data.driverId]) {
                    drivers[data.driverId].isBusy = false;
                    await supabase.from('users').update({ isBusy: false }).eq('id', data.driverId);
                    io.emit('driver_state_update', drivers[data.driverId]);
                }
            } catch(e) {
                console.error("Gagal proses batal driver:", e);
            }
        });
    });
    
// ==========================================
    // JEMBATAN HANDSHAKE PEMBAYARAN & MISI SELESAI
    // ==========================================

    // 1. Terima Bukti Bayar dari Customer -> Teruskan ke Driver
    socket.on('submit_payment', async (data) => {
        try {
            // Update database agar tersimpan (Opsional, pastikan kolomnya ada di Supabase)
            const { error } = await supabase.from('orders').update({ 
                payment_status: 'pending_verification',
                payment_proof: data.proofBase64,
                payment_method: data.method
            }).eq('id', data.orderId);

            // INI YANG PALING PENTING: Teruskan sinyal & foto ke HP Driver
            io.emit('payment_proof_received', {
                orderId: data.orderId,
                method: data.method,
                proofBase64: data.proofBase64
            });
            console.log("📸 Bukti bayar diteruskan ke Driver untuk Order:", data.orderId);
        } catch(e) { console.error("Gagal kirim bukti:", e); }
    });

    // 2. Driver Konfirmasi Bukti -> Teruskan ke Customer & Buka Tahap 3
    socket.on('confirm_payment', async (data) => {
        try {
            await supabase.from('orders').update({ 
                payment_status: 'verified' 
            }).eq('id', data.orderId);
            
            // Beritahu Driver bahwa verifikasi sukses (Buka tombol Misi Selesai)
            io.emit('payment_verified_success', { orderId: data.orderId }); 
            
            // Beritahu Customer bahwa pembayaran sudah Lunas
            io.emit('payment_verified', { orderId: data.orderId }); 
            console.log("✅ Pembayaran diverifikasi untuk Order:", data.orderId);
        } catch(e) { console.error("Gagal verifikasi:", e); }
    });

    // 3. Driver Akhiri Misi beserta Foto Serah Terima
    socket.on('finish_mission', async (data) => {
        try {
            await supabase.from('orders').update({ 
                status: 'completed',
                handover_proof: data.handoverProof // Menyimpan foto serah terima ke DB
            }).eq('id', data.orderId);
            
            // Reset aplikasi Customer dan Driver
            io.emit('mission_ended', { orderId: data.orderId });
            console.log("🏁 Misi Selesai untuk Order:", data.orderId);
        } catch(e) { console.error("Gagal akhiri misi:", e); }
    });

// ==============================================================
    // ANTI AUTO-OFFLINE DRIVER (GRACE PERIOD 60 MENIT)
    // ==============================================================
    if (!global.disconnectTimeouts) global.disconnectTimeouts = {};

    socket.on('disconnect', async () => {
        let disconnectedUser = Object.values(drivers).find(d => d.socketId === socket.id);
        let userType = 'driver';
        
        if (!disconnectedUser) {
            disconnectedUser = Object.values(customers).find(c => c.socketId === socket.id);
            userType = 'customer';
        }

        if (disconnectedUser) {
            console.log(`⚠️ ${userType.toUpperCase()} Terputus (Menunggu Grace Period): ${disconnectedUser.username}`);
            
            // Hapus socket_id saja agar tidak bentrok, tapi status JANGAN diubah dulu
            await supabase.from('users').update({ socket_id: null }).eq('id', disconnectedUser.id);

            if (userType === 'driver') {
                // 1. BERIKAN WAKTU TOLERANSI 60 MENIT (3.600.000 ms)
                global.disconnectTimeouts[disconnectedUser.id] = setTimeout(async () => {
                    console.log(`❌ Driver Offline Permanen (Lewat 60 Menit): ${disconnectedUser.username}`);
                    // Jika 60 menit tidak kembali, baru dimatikan paksa
                    await supabase.from('users').update({ is_online: false, status: 'offline' }).eq('id', disconnectedUser.id);
                    
                    if (drivers[disconnectedUser.id]) {
                        drivers[disconnectedUser.id].status = 'offline';
                        io.emit('driver_state_update', drivers[disconnectedUser.id]); 
                        delete drivers[disconnectedUser.id];
                    }
                    delete global.disconnectTimeouts[disconnectedUser.id];
                }, 3600000); 
            } else {
                // Customer tidak butuh grace period, langsung bersihkan
                await supabase.from('users').update({ is_online: false }).eq('id', disconnectedUser.id);
                delete customers[disconnectedUser.id];
            }
        }
    });

// ==============================================================
    // PENTING: CEK SUSPEND & MENGHENTIKAN TIMER JIKA DRIVER ONLINE
    // ==============================================================
    socket.on('driver_status_change', async (data) => {
        let user = Object.values(drivers).find(d => d.socketId === socket.id);
        
        if (user) {
            // 🛑 1. CEK SUSPEND JIKA MAU ONLINE (PENJAGA PINTU)
            if (data.status === 'online') {
                try {
                    const { data: checkUser } = await supabase
                        .from('users')
                        .select('is_suspended')
                        .eq('id', user.id)
                        .single();
                        
                    // Jika ternyata di database dia dicentang suspend
                    if (checkUser && checkUser.is_suspended) {
                        socket.emit('account_suspended'); // Tembak sinyal peringatan ke HP Driver
                        return; // ⛔ HENTIKAN PROSES! Jangan jadikan Online.
                    }
                } catch(e) { console.error("Cek suspend error:", e); }
            }

            // ♻️ 2. BATALKAN PROSES PEMUTUSAN (Clear Timeout) JIKA KEMBALI ONLINE
            if (data.status === 'online' && global.disconnectTimeouts && global.disconnectTimeouts[user.id]) {
                clearTimeout(global.disconnectTimeouts[user.id]);
                delete global.disconnectTimeouts[user.id];
                console.log(`♻️ Timer Disconnect Dibatalkan untuk Driver: ${user.username}`);
            }

            // ✅ 3. UPDATE STATUS KE DATABASE DAN RAM SERVER
            try {
                user.status = data.status;
                if (data.lat && data.lng) {
                    user.lat = data.lat;
                    user.lng = data.lng;
                }
                
                await supabase.from('users').update({ 
                    status: data.status, 
                    is_online: (data.status === 'online'),
                    lat: user.lat,
                    lng: user.lng
                }).eq('id', user.id);
                
                io.emit('driver_state_update', user);
                console.log(`✅ Status Driver Diperbarui: ${user.username} -> ${data.status}`);
            } catch (e) {
                console.error("Gagal update status driver:", e);
            }
        }
    });
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 SERVER MVP ORDER LOGIC READY (PORT ${PORT})`));

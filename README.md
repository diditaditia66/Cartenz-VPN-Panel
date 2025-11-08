# Cartenz Panel

Panel manajemen akun (SSH/Xray), billing sederhana, SSE streaming output, trial limit harian, & manajemen SSH.

## Fitur
- Login + session
- Add akun SSH/VMess/VLess/Trojan/SS (via script)
- Trial 1x per hari (dengan lock anti double-trigger)
- SSE untuk output real-time + notif saldo & trial di UI
- Admin CRUD user & balance
- Daftar & hapus akun (SSH/Xray)

## Struktur
Lihat `public/` untuk file UI (HTML/CSS/JS), backend utama ada di `server.cjs`.

## Jalankan Lokal
```bash
cp .env.example .env
# edit SESSION_SECRET & PORT bila perlu

npm install
npm run start
# buka http://localhost:8080

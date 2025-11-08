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

## Jalankan dengan PM2 (Produksi)
# di server
cp .env.example .env
# isi SESSION_SECRET dkk

npm install --production
npm run pm2
# cek status
pm2 status
pm2 logs cartenz-panel

## Deploy via Nginx (opsional)
- Salin deploy/nginx/panel.conf.example ke /etc/nginx/sites-available/panel.conf
- Sesuaikan path cert Let’s Encrypt
- Enable site & reload Nginx:
sudo ln -s /etc/nginx/sites-available/panel.conf /etc/nginx/sites-enabled/panel.conf
sudo nginx -t && sudo systemctl reload nginx

## Deploy via Cloudflare Tunnel (disarankan, simple)
- Buat tunnel & route DNS sesuai panduan
- Pakai deploy/cloudflared/config.yml.example sebagai acuan
- Jalankan service:
sudo cloudflared --config /etc/cloudflared/config.yml service install
sudo systemctl enable --now cloudflared

